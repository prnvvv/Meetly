"""The SQLite -> PostgreSQL migration procedure (run here against a SQLite target; the PostgreSQL
specifics are exercised by the scratch-schema rehearsal documented in docs/database/MIGRATION_GUIDE.md)."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import sys
from dataclasses import asdict
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select, text

from app.config import settings
from app.database.database import Base
from app.models import Meeting, Participant, User, UserProfile
from app.security.crypto import generate_key

_spec = importlib.util.spec_from_file_location(
    "migrate_sqlite_to_postgres", Path(__file__).resolve().parents[1] / "scripts" / "migrate_sqlite_to_postgres.py"
)
mig = importlib.util.module_from_spec(_spec)
sys.modules["migrate_sqlite_to_postgres"] = mig
_spec.loader.exec_module(mig)

LEGACY_DDL = [
    "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, created_at DATETIME NOT NULL, clerk_id VARCHAR(255), last_login_at DATETIME, preferences TEXT)",
    "CREATE TABLE meetings (id INTEGER PRIMARY KEY, meeting_id VARCHAR(32) NOT NULL UNIQUE, host_id INTEGER NOT NULL REFERENCES users(id), title VARCHAR(255) NOT NULL, description TEXT, start_time DATETIME NOT NULL, end_time DATETIME, duration INTEGER, status VARCHAR(16) NOT NULL, meeting_link VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255), settings TEXT, created_at DATETIME NOT NULL, legacy_flag VARCHAR(10))",
    "CREATE TABLE participants (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), meeting_id INTEGER NOT NULL REFERENCES meetings(id), display_name VARCHAR(100) NOT NULL, is_host BOOLEAN NOT NULL DEFAULT 0, is_muted BOOLEAN NOT NULL DEFAULT 1, is_video_on BOOLEAN NOT NULL DEFAULT 0, screen_share BOOLEAN NOT NULL DEFAULT 0, joined_at DATETIME, left_at DATETIME)",
    "CREATE TABLE meeting_history (id INTEGER PRIMARY KEY, meeting_id INTEGER NOT NULL UNIQUE REFERENCES meetings(id), started_at DATETIME NOT NULL, ended_at DATETIME, duration INTEGER, participants_count INTEGER NOT NULL DEFAULT 0)",
]

LEGACY_ROWS = [
    "INSERT INTO users VALUES (1, 'Demo User', 'demo@example.com', '2026-01-01 00:00:00', NULL, NULL, NULL)",
    "INSERT INTO users VALUES (7, 'Real User', 'real@example.com', '2026-02-02 10:11:12.123456', 'user_real', '2026-03-03 00:00:00', '{\"camera_id\": \"abc\"}')",
    "INSERT INTO users VALUES (9, 'Real User', 'other@example.com', '2026-02-03 00:00:00', 'user_other', NULL, NULL)",
    "INSERT INTO meetings VALUES (3, '555000111', 7, 'Old meeting', 'desc', '2026-01-01 10:00:00', '2026-01-01 11:00:00', 60, 'ended', 'https://x/555000111', '$2b$12$hash', '{\"waitingRoom\": true, \"lockMeeting\": false}', '2026-01-01 09:00:00', 'x')",
    "INSERT INTO meetings VALUES (4, '555000222', 9, 'Second', NULL, '2026-04-04 10:00:00', NULL, NULL, 'active', 'https://x/555000222', NULL, NULL, '2026-04-04 09:00:00', NULL)",
    "INSERT INTO participants VALUES (1, 7, 3, 'Real User', 1, 0, 1, 0, '2026-01-01 10:01:00', '2026-01-01 10:50:00')",
    "INSERT INTO participants VALUES (2, 9, 3, 'Other', 0, 1, 0, 0, NULL, NULL)",
    "INSERT INTO participants VALUES (3, NULL, 4, 'Guest', 0, 1, 0, 0, NULL, NULL)",
    "INSERT INTO meeting_history VALUES (1, 3, '2026-01-01 10:00:00', '2026-01-01 11:00:00', 60, 2)",
]


def make_source(path: Path, extra_rows: list[str] = (), fk_off: bool = False) -> Path:
    conn = sqlite3.connect(path)
    for stmt in LEGACY_DDL + LEGACY_ROWS + list(extra_rows):
        conn.execute(stmt)
    conn.commit()
    conn.close()
    return path


def make_target(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'target.db'}")
    Base.metadata.create_all(engine)
    return engine


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(source, engine, **kw):
    return mig.copy_database(source, engine, **kw)


def count(engine, table: str) -> int:
    with engine.connect() as c:
        return c.execute(text(f"SELECT count(*) FROM {table}")).scalar()


def test_dry_run_validates_everything_but_commits_nothing(tmp_path):
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    before = digest(src)
    report = run(src, engine)
    assert report.ok and report.mode == "dry-run" and not report.committed
    assert report.counts["users"] == {"source": 3, "target": 3}
    assert count(engine, "users") == 0 and count(engine, "meetings") == 0 and count(engine, "user_profiles") == 0
    assert digest(src) == before and report.source_unchanged


def test_apply_copies_every_row_exactly_and_preserves_identity(tmp_path):
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    report = run(src, engine, apply=True)
    assert report.ok and report.committed
    assert {t: c["target"] for t, c in report.counts.items() if t in ("users", "meetings", "participants", "meeting_history")} == {
        "users": 3, "meetings": 2, "participants": 3, "meeting_history": 1,
    }
    from sqlalchemy.orm import Session

    with Session(engine) as db:
        users = {u.id: u for u in db.scalars(select(User))}
        assert set(users) == {1, 7, 9} and users[7].clerk_id == "user_real" and users[1].clerk_id is None
        assert users[7].created_at.isoformat().startswith("2026-02-02T10:11:12.123456+00:00")  # timestamps, aware UTC
        assert users[7].preferences == '{"camera_id": "abc"}'
        m = db.scalars(select(Meeting).where(Meeting.id == 3)).one()
        assert m.password_hash == "$2b$12$hash" and m.duration == 60
        assert m.waiting_room_enabled is False and m.admission_mode == "host_approval"  # existing meetings stay OFF
        assert '"waitingRoom": true' in m.settings  # the legacy flag is kept as data, not enforced
        host = db.scalars(select(Participant).where(Participant.id == 1)).one()
        assert host.is_host is True and host.is_muted is False and host.joined_at is not None
        assert db.scalars(select(Participant).where(Participant.id == 3)).one().user_id is None  # guests stay guests


def test_every_user_gets_a_unique_profile(tmp_path):
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    run(src, engine, apply=True)
    from sqlalchemy.orm import Session

    with Session(engine) as db:
        profiles = {p.user_id: p for p in db.scalars(select(UserProfile))}
        assert set(profiles) == {1, 7, 9}
        names = [p.username for p in profiles.values()]
        assert len(set(names)) == 3 and "real_user" in names and "real_user1" in names  # two users named "Real User"
        assert all(p.visibility == "public" for p in profiles.values())


def test_the_original_backup_is_never_modified_even_when_the_run_fails(tmp_path):
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    before = digest(src)
    run(src, engine, apply=True)
    second = run(src, engine, apply=True)  # target now not empty
    assert not second.ok and any("not empty" in p for p in second.problems)
    assert digest(src) == before and second.source_unchanged and second.source_sha256_before == before


def test_a_non_empty_target_is_refused_and_left_untouched(tmp_path):
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    with engine.begin() as c:
        c.execute(text("INSERT INTO users (id, name, email, created_at) VALUES (50, 'Existing', 'e@x.invalid', '2026-01-01 00:00:00')"))
    report = run(src, engine, apply=True)
    assert not report.ok and not report.committed
    assert count(engine, "users") == 1  # only the pre-existing row


def test_duplicate_participant_rows_stop_the_run_unless_explicitly_merged(tmp_path):
    src = make_source(tmp_path / "prod.db", ["INSERT INTO participants VALUES (4, 7, 3, 'Real User (second tab)', 0, 1, 0, 0, NULL, NULL)"])
    engine = make_target(tmp_path)
    stopped = run(src, engine, apply=True)
    assert not stopped.ok and any("several participant rows" in p and "4" in p for p in stopped.problems)
    assert count(engine, "participants") == 0  # nothing written
    merged = run(src, engine, apply=True, merge_duplicate_participants=True)
    assert merged.ok and merged.merged_duplicate_participants == [4]
    assert count(engine, "participants") == 3  # the first row of the pair was kept, the duplicate was not copied
    assert any("NOT copied" in n for n in merged.notes)


def test_orphaned_foreign_keys_in_the_source_stop_the_run(tmp_path):
    src = make_source(tmp_path / "prod.db", ["INSERT INTO participants VALUES (5, 7, 999, 'Ghost', 0, 1, 0, 0, NULL, NULL)"])
    engine = make_target(tmp_path)
    report = run(src, engine, apply=True)
    assert not report.ok and any("orphaned foreign keys" in p for p in report.problems)
    assert count(engine, "users") == 0


def test_a_corrupt_source_is_refused(tmp_path):
    bad = tmp_path / "bad.db"
    data = bytearray(make_source(tmp_path / "prod.db").read_bytes())
    data[4096:4200] = b"\x00" * 104  # damage a page
    bad.write_bytes(bytes(data))
    engine = make_target(tmp_path)
    report = run(bad, engine, apply=True)
    assert not report.ok and count(engine, "users") == 0


def test_column_differences_are_reported_not_hidden(tmp_path):
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    report = run(src, engine)
    mapping = report.column_mapping
    assert "legacy_flag" in mapping["meetings"]["source_only_NOT_copied"]
    assert {"waiting_room_enabled", "admission_mode"} <= set(mapping["meetings"]["target_only_use_defaults"])
    assert "email_ciphertext" in mapping["users"]["target_only_use_defaults"]
    assert mapping["friend_requests"]["source"] == "table not in source"


def test_a_failure_halfway_rolls_everything_back(tmp_path, monkeypatch):
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    monkeypatch.setattr(mig, "generate_profiles", lambda users: (_ for _ in ()).throw(RuntimeError("boom on ada@example.com")))
    report = run(src, engine, apply=True)
    assert not report.ok and not report.committed
    assert count(engine, "users") == 0 and count(engine, "meetings") == 0 and count(engine, "participants") == 0
    assert "ada@example.com" not in json.dumps(asdict(report), default=str)  # the error text (which may hold data) is not reported


def test_emails_are_encrypted_in_the_same_transaction_when_the_mode_is_on(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "email_encryption_mode", "dual")
    monkeypatch.setattr(settings, "field_encryption_keys", f"1:{generate_key()}")
    monkeypatch.setattr(settings, "field_encryption_key_version", "1")
    monkeypatch.setattr(settings, "field_blind_index_keys", f"1:{generate_key()}")
    monkeypatch.setattr(settings, "field_blind_index_key_version", "1")
    from app.services import account_email

    account_email._cipher_for.cache_clear()
    account_email._index_for.cache_clear()
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    report = run(src, engine, apply=True)
    assert report.ok and report.derived["emails_encrypted"] == 3
    from sqlalchemy.orm import Session

    with Session(engine) as db:
        user = db.get(User, 7)
        assert account_email.get_email(user) == "real@example.com" and user.email == "real@example.com"  # plaintext kept


def test_the_report_contains_counts_and_ids_but_no_personal_data(tmp_path):
    src, engine = make_source(tmp_path / "prod.db"), make_target(tmp_path)
    blob = json.dumps(asdict(run(src, engine, apply=True)), default=str).lower()
    for private in ("example.com", "real user", "$2b$12$hash", "user_real", "camera_id"):
        assert private not in blob


def test_running_the_same_copy_twice_into_fresh_targets_gives_identical_results(tmp_path):
    src = make_source(tmp_path / "prod.db")
    a, b = create_engine(f"sqlite:///{tmp_path / 'a.db'}"), create_engine(f"sqlite:///{tmp_path / 'b.db'}")
    Base.metadata.create_all(a)
    Base.metadata.create_all(b)
    ra, rb = run(src, a, apply=True), run(src, b, apply=True)
    assert ra.ok and rb.ok and ra.counts == rb.counts and ra.derived == rb.derived
    with a.connect() as ca, b.connect() as cb:
        q = text("SELECT user_id, username FROM user_profiles ORDER BY user_id")
        assert ca.execute(q).all() == cb.execute(q).all()  # repeatable and deterministic
