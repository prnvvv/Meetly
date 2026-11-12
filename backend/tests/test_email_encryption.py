"""Account email encryption: AES-256-GCM + HMAC blind index, modes, backfill, failure handling."""

from __future__ import annotations

import hashlib
import importlib.util
import logging
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app import auth
from app.config import settings
from app.database.database import Base
from app.models.user import User
from app.security import blind_index as bi
from app.security.crypto import generate_key
from app.services import account_email
from tests.test_auth import bearer
from tests.test_profiles import client  # noqa: F401  (fixture)

ADDRESS = "Ada.Lovelace+tag@Example.COM"
NORMALISED = "ada.lovelace+tag@example.com"

_spec = importlib.util.spec_from_file_location(
    "backfill_email_encryption", Path(__file__).resolve().parents[1] / "scripts" / "backfill_email_encryption.py"
)
backfill_mod = importlib.util.module_from_spec(_spec)
sys.modules["backfill_email_encryption"] = backfill_mod
_spec.loader.exec_module(backfill_mod)


def configure(monkeypatch, mode="dual", enc_version="1", idx_version="1", enc_keys=None, idx_keys=None):
    enc_keys = enc_keys or f"{enc_version}:{generate_key()}"
    idx_keys = idx_keys or f"{idx_version}:{generate_key()}"
    monkeypatch.setattr(settings, "email_encryption_mode", mode)
    monkeypatch.setattr(settings, "field_encryption_keys", enc_keys)
    monkeypatch.setattr(settings, "field_encryption_key_version", enc_version)
    monkeypatch.setattr(settings, "field_blind_index_keys", idx_keys)
    monkeypatch.setattr(settings, "field_blind_index_key_version", idx_version)
    return enc_keys, idx_keys


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        yield session
    engine.dispose()


def make_user(db, clerk="u1", email=None) -> User:
    user = User(name="N", email=email or f"{clerk}@x.invalid", clerk_id=clerk)
    db.add(user)
    db.flush()
    return user


def row_text(db, user_id: int) -> str:
    """Every stored column of the row, concatenated: used to prove no plaintext remains."""
    return " ".join(str(v) for v in db.execute(text("SELECT * FROM users WHERE id = :i"), {"i": user_id}).one())


# ---- normalisation and the blind index ------------------------------------------------------------


def test_normalisation_is_consistent():
    assert bi.normalize_email("  ADA@Example.com ") == "ada@example.com"
    assert bi.normalize_email("ａｄａ@example.com") == "ada@example.com"  # NFKC folds full-width letters
    assert bi.normalize_email("a+tag@x.io") == "a+tag@x.io"  # tags and dots are NOT merged
    assert bi.normalize_email("a.b@x.io") != bi.normalize_email("ab@x.io")


@pytest.mark.parametrize("bad", ["", "   ", "nope", "a@b", "a b@c.io", "@x.io", "a@@x.io", "x" * 260 + "@a.io"])
def test_invalid_emails_are_rejected(bad):
    with pytest.raises(bi.InvalidEmail):
        bi.normalize_email(bad)


def test_blind_index_is_keyed_deterministic_and_not_a_plain_hash():
    a = bi.BlindIndex.from_settings(f"1:{generate_key()}", "1")
    b = bi.BlindIndex.from_settings(f"1:{generate_key()}", "1")
    value = a.index("users.email", NORMALISED)
    assert value == a.index("users.email", NORMALISED) and len(value) == 64
    assert value != b.index("users.email", NORMALISED)  # a different key gives a different index
    assert value != hashlib.sha256(NORMALISED.encode()).hexdigest()  # never an unkeyed hash
    assert value != a.index("other.field", NORMALISED)  # domain separated


def test_blind_index_rotation_candidates():
    k1, k2 = generate_key(), generate_key()
    old = bi.BlindIndex.from_settings(f"1:{k1}", "1")
    new = bi.BlindIndex.from_settings(f"1:{k1},2:{k2}", "2")
    assert old.index("p", "x@y.io") in new.candidates("p", "x@y.io")
    assert new.index("p", "x@y.io") != old.index("p", "x@y.io")


@pytest.mark.parametrize("spec", ["", "1:short", "bad", "1:" + "!!!!"])
def test_blind_index_config_errors(spec):
    with pytest.raises(bi.BlindIndexConfigError):
        bi.BlindIndex.from_settings(spec, "1")


def test_configuration_problems_are_reported_without_secrets(monkeypatch):
    monkeypatch.setattr(settings, "email_encryption_mode", "dual")
    monkeypatch.setattr(settings, "field_encryption_keys", "")
    monkeypatch.setattr(settings, "field_blind_index_keys", "1:tooshort")
    problems = settings.validate_email_encryption()
    assert len(problems) == 2 and not any("tooshort" in p for p in problems)
    monkeypatch.setattr(settings, "email_encryption_mode", "sometimes")
    assert settings.validate_email_encryption() == ["EMAIL_ENCRYPTION_MODE must be off, dual or encrypted"]
    monkeypatch.setattr(settings, "email_encryption_mode", "off")
    assert settings.validate_email_encryption() == []


# ---- storing and reading ----------------------------------------------------------------------------


def test_off_mode_keeps_today_behaviour(db, monkeypatch):
    monkeypatch.setattr(settings, "email_encryption_mode", "off")
    user = make_user(db)
    account_email.set_email(user, ADDRESS)
    assert user.email == ADDRESS and user.email_ciphertext is None and user.email_blind_index is None
    assert account_email.get_email(user) == ADDRESS


def test_dual_mode_writes_everything_and_reads_the_ciphertext(db, monkeypatch):
    configure(monkeypatch, "dual")
    user = make_user(db)
    account_email.set_email(user, ADDRESS)
    db.commit()
    assert user.email == NORMALISED  # plaintext kept (normalised) until the approved scrub
    assert user.email_ciphertext.startswith("enc:v1:1:") and NORMALISED not in user.email_ciphertext
    assert len(user.email_blind_index) == 64 and user.email_key_version == "1" and user.email_bidx_version == "1"
    assert account_email.get_email(user) == NORMALISED


def test_encrypted_mode_leaves_no_plaintext_in_the_row(db, monkeypatch):
    configure(monkeypatch, "encrypted")
    user = make_user(db)
    account_email.set_email(user, ADDRESS)
    db.commit()
    stored = row_text(db, user.id).lower()
    assert "ada" not in stored and "lovelace" not in stored and "example.com" not in stored
    assert user.email == f"masked-{user.id}@masked.invalid"
    assert account_email.get_email(user) == NORMALISED


def test_set_email_requires_a_flushed_row(db, monkeypatch):
    configure(monkeypatch, "dual")
    with pytest.raises(RuntimeError):
        account_email.set_email(User(name="N", email="x@y.io"), ADDRESS)


def test_nonce_is_unique_per_encryption(db, monkeypatch):
    configure(monkeypatch, "dual")
    a, b = make_user(db, "a"), make_user(db, "b")
    account_email.set_email(a, "same@example.com")
    account_email.set_email(b, "same@example.com")
    assert a.email_ciphertext != b.email_ciphertext


def test_ciphertext_is_bound_to_its_row(db, monkeypatch):
    configure(monkeypatch, "encrypted")
    a, b = make_user(db, "a"), make_user(db, "b")
    account_email.set_email(a, "alice@example.com")
    account_email.set_email(b, "bob@example.com")
    b.email_ciphertext = a.email_ciphertext  # copy alice's value onto bob's row
    assert account_email.get_email(b) is None  # fails closed; it does not reveal alice's address


# ---- uniqueness and lookup -----------------------------------------------------------------------------


def test_duplicate_emails_are_blocked_case_insensitively(db, monkeypatch):
    configure(monkeypatch, "dual")
    a, b = make_user(db, "a"), make_user(db, "b", "other@x.invalid")
    account_email.set_email(a, "Person@Example.com")
    db.commit()
    account_email.set_email(b, "person@example.COM")
    with pytest.raises(IntegrityError):
        db.commit()


def test_lookup_ignores_case_and_finds_encrypted_and_legacy_rows(db, monkeypatch):
    configure(monkeypatch, "encrypted")
    enc = make_user(db, "enc")
    account_email.set_email(enc, "Carol@Example.com")
    legacy = make_user(db, "legacy", "Legacy.User@Example.com")  # not backfilled yet
    db.commit()
    assert account_email.find_by_email(db, "carol@EXAMPLE.com").id == enc.id
    assert account_email.find_by_email(db, "legacy.user@example.com").id == legacy.id
    assert account_email.find_by_email(db, "nobody@example.com") is None
    assert account_email.find_by_email(db, "not an email") is None


def test_lookup_survives_blind_index_key_rotation(db, monkeypatch):
    k1, k2 = generate_key(), generate_key()
    enc = f"1:{generate_key()}"
    configure(monkeypatch, "encrypted", enc_keys=enc, idx_keys=f"1:{k1}")
    user = make_user(db)
    account_email.set_email(user, "rot@example.com")
    db.commit()
    account_email._index_for.cache_clear()
    configure(monkeypatch, "encrypted", enc_keys=enc, idx_version="2", idx_keys=f"1:{k1},2:{k2}")
    assert account_email.find_by_email(db, "ROT@example.com").id == user.id


def test_ciphertext_still_decrypts_after_encryption_key_rotation(db, monkeypatch):
    old = generate_key()
    configure(monkeypatch, "dual", enc_keys=f"1:{old}")
    user = make_user(db)
    account_email.set_email(user, "rot2@example.com")
    configure(monkeypatch, "dual", enc_version="2", enc_keys=f"1:{old},2:{generate_key()}")
    account_email._cipher_for.cache_clear()
    assert account_email.get_email(user) == "rot2@example.com"
    assert user.email_ciphertext.startswith("enc:v1:1:")  # still the old version until re-encrypted


# ---- failures ----------------------------------------------------------------------------------------------


def test_wrong_key_falls_back_safely_and_logs_no_personal_data(db, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    key = generate_key()
    configure(monkeypatch, "dual", enc_keys=f"1:{key}")
    dual = make_user(db, "d")
    account_email.set_email(dual, "dual@example.com")
    enc_user = make_user(db, "e")
    configure(monkeypatch, "encrypted", enc_keys=f"1:{key}")
    account_email.set_email(enc_user, "secret@example.com")
    # now run with a different key
    wrong = generate_key()
    configure(monkeypatch, "encrypted", enc_keys=f"1:{wrong}")
    account_email._cipher_for.cache_clear()
    assert account_email.get_email(dual) == "dual@example.com"  # plaintext still present in dual
    assert account_email.get_email(enc_user) is None  # nothing to fall back to, no exception
    logs = "\n".join(r.getMessage() for r in caplog.records)
    assert "secret@example.com" not in logs and wrong not in logs and key not in logs
    assert "dual@example.com" not in logs


def test_missing_keys_do_not_crash_reads(db, monkeypatch):
    configure(monkeypatch, "dual")
    user = make_user(db)
    account_email.set_email(user, "x@example.com")
    monkeypatch.setattr(settings, "field_encryption_keys", "")
    assert account_email.get_email(user) == "x@example.com"
    monkeypatch.setattr(settings, "email_encryption_mode", "encrypted")
    user.email = account_email.masked_placeholder(user.id)
    assert account_email.get_email(user) is None
    with pytest.raises(Exception):
        account_email.set_email(make_user(db, "z"), "y@example.com")  # cannot encrypt without keys


def test_tampered_ciphertext_is_rejected(db, monkeypatch):
    configure(monkeypatch, "encrypted")
    user = make_user(db)
    account_email.set_email(user, "t@example.com")
    user.email_ciphertext = user.email_ciphertext[:-4] + "AAAA"
    assert account_email.get_email(user) is None


# ---- through the real sign-in path ---------------------------------------------------------------------------


@pytest.fixture()
def clerk_email(monkeypatch):
    emails = {}
    monkeypatch.setattr(auth, "_profile_from_clerk", lambda clerk_id: ("Test Person", emails.get(clerk_id, "x@y.invalid")))
    return emails


def test_sign_up_and_login_with_encrypted_email(client, clerk_email, monkeypatch):
    configure(monkeypatch, "encrypted")
    clerk_email["user_a"] = "First.Person@Example.com"
    me = client.get("/api/users/me", headers=bearer("user_a"))
    assert me.status_code == 200 and me.json()["email"] == "first.person@example.com"
    with client.Session() as db:
        user = db.scalars(select(User).where(User.clerk_id == "user_a")).one()
        assert "first.person" not in row_text(db, user.id).lower()
        assert user.email_ciphertext and user.email_blind_index
    again = client.get("/api/users/me", headers=bearer("user_a"))  # login again: same account
    assert again.json()["id"] == me.json()["id"]
    assert client.get("/api/users/me/profile", headers=bearer("user_a")).status_code == 200


def test_two_accounts_with_the_same_email_both_sign_in_without_a_stored_duplicate(client, clerk_email, monkeypatch):
    configure(monkeypatch, "encrypted")
    clerk_email["user_a"] = "shared@example.com"
    clerk_email["user_b"] = "SHARED@example.com"
    assert client.get("/api/users/me", headers=bearer("user_a")).json()["email"] == "shared@example.com"
    other = client.get("/api/users/me", headers=bearer("user_b"))
    assert other.status_code == 200 and other.json()["email"] == ""  # signed in; address not stored twice
    with client.Session() as db:
        assert len(db.scalars(select(User).where(User.email_blind_index.is_not(None))).all()) == 1


def test_sign_in_still_works_when_the_encryption_keys_are_wrong(client, clerk_email, monkeypatch):
    configure(monkeypatch, "dual")
    clerk_email["user_a"] = "keep@example.com"
    client.get("/api/users/me", headers=bearer("user_a"))
    configure(monkeypatch, "dual")  # brand-new, different keys
    account_email._cipher_for.cache_clear()
    again = client.get("/api/users/me", headers=bearer("user_a"))
    assert again.status_code == 200 and again.json()["email"] == "keep@example.com"  # plaintext fallback in dual


def test_friend_discovery_and_invitations_do_not_depend_on_email(client, clerk_email, monkeypatch):
    configure(monkeypatch, "encrypted")
    clerk_email["user_a"], clerk_email["user_b"] = "a@example.com", "b@example.com"
    a = client.get("/api/users/me", headers=bearer("user_a")).json()["id"]
    client.patch("/api/users/me/profile", headers=bearer("user_b"), json={"username": "findable_b"})
    found = client.get("/api/users/search?q=findable", headers=bearer("user_a"))
    assert [p["username"] for p in found.json()["items"]] == ["findable_b"]
    assert "example.com" not in found.text and "@" not in found.text  # no address in any response
    assert client.post("/api/friends/requests", json={"user_id": found.json()["items"][0]["user_id"]},
                       headers=bearer("user_a")).status_code == 201
    assert a


# ---- the backfill ----------------------------------------------------------------------------------------------------


def legacy_db(db):
    rows = [
        ("u1", "alice@example.com"),
        ("u2", "Bob@Example.com"),
        ("u3", "ALICE@example.com"),  # same mailbox as u1, different spelling: a conflict
        ("u4", "masked-9@masked.invalid"),  # nothing real stored
        ("u5", "not-an-email"),
        ("u6", "carol@example.com"),
    ]
    for clerk, email in rows:
        make_user(db, clerk, email)
    db.commit()


def test_backfill_dry_run_writes_nothing(db, monkeypatch):
    configure(monkeypatch, "dual")
    legacy_db(db)
    report = backfill_mod.backfill(db, apply=False)
    assert report.total == 6 and report.encrypted == 4  # would be encrypted (the conflict is only found on write)
    assert db.scalar(text("SELECT count(*) FROM users WHERE email_ciphertext IS NOT NULL")) == 0


def test_backfill_apply_is_complete_resumable_and_loses_nothing(db, monkeypatch):
    configure(monkeypatch, "dual")
    legacy_db(db)
    before = {r[0]: r[1] for r in db.execute(text("SELECT id, email FROM users"))}
    report = backfill_mod.backfill(db, apply=True, batch_size=2)
    assert report.encrypted == 3 and len(report.conflicts) == 1  # u3 collides with u1's blind index
    assert len(report.skipped_masked) == 1 and len(report.skipped_invalid) == 1 and not report.failures
    assert {r[0]: r[1] for r in db.execute(text("SELECT id, email FROM users"))} == before  # plaintext untouched
    again = backfill_mod.backfill(db, apply=True)
    assert again.encrypted == 0 and again.already_encrypted == 3  # idempotent
    v = backfill_mod.verify(db)
    assert v.verified_ok == 3 and not v.verify_failed
    ids = {u.clerk_id: u.id for u in db.scalars(select(User))}
    assert ids["u1"] in {u.id for u in db.scalars(select(User).where(User.email_ciphertext.is_not(None)))}
    assert report.conflicts == [ids["u3"]]


def test_backfill_limit_allows_a_small_first_run(db, monkeypatch):
    configure(monkeypatch, "dual")
    legacy_db(db)
    r = backfill_mod.backfill(db, apply=True, limit=2)
    assert r.encrypted + len(r.skipped_masked) + len(r.skipped_invalid) + len(r.conflicts) <= 2


def test_backfill_report_contains_no_personal_data(db, monkeypatch):
    configure(monkeypatch, "dual")
    legacy_db(db)
    report = backfill_mod.backfill(db, apply=True)
    blob = str(report.summary()).lower()
    assert "example.com" not in blob and "alice" not in blob


def test_backfill_refuses_when_mode_is_off(db, monkeypatch):
    monkeypatch.setattr(settings, "email_encryption_mode", "off")
    with pytest.raises(SystemExit):
        backfill_mod.backfill(db, apply=True)


def test_verify_detects_a_row_that_does_not_round_trip(db, monkeypatch):
    configure(monkeypatch, "dual")
    legacy_db(db)
    backfill_mod.backfill(db, apply=True)
    victim = db.scalars(select(User).where(User.email_ciphertext.is_not(None))).first()
    victim.email_blind_index = "0" * 64
    db.commit()
    assert backfill_mod.verify(db).verify_failed == [victim.id]


def test_scrub_only_runs_on_verified_data_and_only_when_applied(db, monkeypatch):
    configure(monkeypatch, "dual")
    legacy_db(db)
    backfill_mod.backfill(db, apply=True)
    plain_before = {r[0]: r[1] for r in db.execute(text("SELECT id, email FROM users"))}
    dry = backfill_mod.scrub(db, apply=False)
    assert dry.scrubbed == 0
    assert {r[0]: r[1] for r in db.execute(text("SELECT id, email FROM users"))} == plain_before  # dry run changed nothing

    victim = db.scalars(select(User).where(User.email_ciphertext.is_not(None))).first()
    victim.email_ciphertext = victim.email_ciphertext[:-4] + "AAAA"
    db.commit()
    with pytest.raises(SystemExit, match="do not verify"):
        backfill_mod.scrub(db, apply=True)  # nothing is scrubbed while any row fails verification
    assert {r[0]: r[1] for r in db.execute(text("SELECT id, email FROM users"))} == plain_before


def test_scrub_replaces_plaintext_and_reads_still_work(db, monkeypatch):
    configure(monkeypatch, "dual")
    legacy_db(db)
    backfill_mod.backfill(db, apply=True)
    done = backfill_mod.scrub(db, apply=True)
    assert done.scrubbed == 3
    alice = db.scalars(select(User).where(User.clerk_id == "u1")).one()
    assert alice.email == f"masked-{alice.id}@masked.invalid"
    assert account_email.get_email(alice) == "alice@example.com"
    assert account_email.find_by_email(db, "ALICE@example.com").id == alice.id
    # rows that were never encrypted keep what they had (we do not destroy what we cannot restore)
    assert db.scalars(select(User).where(User.clerk_id == "u5")).one().email == "not-an-email"


def test_scrub_apply_needs_the_backup_acknowledgement(monkeypatch):
    configure(monkeypatch, "dual")
    monkeypatch.setattr(sys, "argv", ["x", "scrub", "--apply"])
    with pytest.raises(SystemExit, match="i-have-a-verified-backup"):
        backfill_mod.main()


def test_no_log_line_contains_an_address_or_key(db, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    enc, idx = configure(monkeypatch, "dual")
    legacy_db(db)
    backfill_mod.backfill(db, apply=True)
    backfill_mod.verify(db)
    for user in db.scalars(select(User)):
        account_email.get_email(user)
    logs = "\n".join(r.getMessage() for r in caplog.records).lower()
    assert "example.com" not in logs and enc.split(":")[1].lower() not in logs and idx.split(":")[1].lower() not in logs


def test_rekey_moves_rows_to_the_active_key_versions_and_keeps_them_readable(db, monkeypatch):
    enc1, idx1 = generate_key(), generate_key()
    configure(monkeypatch, "dual", enc_keys=f"1:{enc1}", idx_keys=f"1:{idx1}")
    legacy_db(db)
    backfill_mod.backfill(db, apply=True)
    old = {u.id: (u.email_ciphertext, u.email_blind_index) for u in db.scalars(select(User)) if u.email_ciphertext}

    enc2, idx2 = generate_key(), generate_key()
    configure(monkeypatch, "dual", enc_version="2", idx_version="2",
              enc_keys=f"1:{enc1},2:{enc2}", idx_keys=f"1:{idx1},2:{idx2}")
    account_email._cipher_for.cache_clear()
    account_email._index_for.cache_clear()
    dry = backfill_mod.rekey(db, apply=False)
    assert dry.encrypted == 3 and {u.id: u.email_ciphertext for u in db.scalars(select(User)) if u.email_ciphertext} == {k: v[0] for k, v in old.items()}
    done = backfill_mod.rekey(db, apply=True)
    assert done.encrypted == 3 and not done.failures and not done.conflicts
    for user in db.scalars(select(User).where(User.email_ciphertext.is_not(None))):
        assert user.email_key_version == "2" and user.email_bidx_version == "2"
        assert user.email_ciphertext != old[user.id][0] and user.email_blind_index != old[user.id][1]
    assert backfill_mod.verify(db).verified_ok == 3
    # the old keys can now be retired: nothing depends on them any more
    monkeypatch.setattr(settings, "field_encryption_keys", f"2:{enc2}")
    monkeypatch.setattr(settings, "field_blind_index_keys", f"2:{idx2}")
    account_email._cipher_for.cache_clear()
    account_email._index_for.cache_clear()
    assert backfill_mod.verify(db).verified_ok == 3
    assert account_email.find_by_email(db, "ALICE@example.com") is not None
    assert backfill_mod.rekey(db, apply=True).encrypted == 0  # idempotent
