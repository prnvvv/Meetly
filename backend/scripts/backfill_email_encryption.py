"""Encrypt existing account emails in controlled batches, then verify. Resumable and non-destructive.

    python scripts/backfill_email_encryption.py                 # dry run: report only, writes nothing
    python scripts/backfill_email_encryption.py --apply         # encrypt rows that are not yet encrypted
    python scripts/backfill_email_encryption.py verify          # decrypt every row and cross-check
    python scripts/backfill_email_encryption.py rekey --apply   # move rows to the ACTIVE key versions (rotation)
    python scripts/backfill_email_encryption.py scrub --apply --i-have-a-verified-backup
                                                                # LAST step: blank the plaintext column

``--apply`` only ADDS the ciphertext, key versions and blind index to rows; the plaintext
column is left alone, so it can be re-run at any time and nothing can be lost. ``scrub`` is the
only destructive step (it replaces the plaintext with a non-identifying placeholder); it
refuses unless every row verifies, a verified backup is acknowledged, and (on staging or
production) ``MEETLY_CONFIRM_DB=<project ref>`` is set. It does not run by default and has not
been run on any shared database.

The report contains counts and user ids only: never an address, ciphertext or key.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, func, select  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import settings  # noqa: E402
from app.database.database import normalize_database_url  # noqa: E402
from app.models.user import User  # noqa: E402
from app.security.blind_index import InvalidEmail, normalize_email  # noqa: E402
from app.security.crypto import CryptoConfigError, DecryptionError  # noqa: E402
from app.services import account_email  # noqa: E402


@dataclass
class Report:
    total: int = 0
    already_encrypted: int = 0
    encrypted: int = 0
    skipped_masked: list[int] = field(default_factory=list)  # no real address stored
    skipped_invalid: list[int] = field(default_factory=list)  # plaintext is not an email
    conflicts: list[int] = field(default_factory=list)  # same mailbox as another account
    failures: list[int] = field(default_factory=list)
    verified_ok: int = 0
    verify_failed: list[int] = field(default_factory=list)
    scrubbed: int = 0

    def summary(self) -> dict:
        d = asdict(self)
        for key in ("skipped_masked", "skipped_invalid", "conflicts", "failures", "verify_failed"):
            d[key + "_count"] = len(d[key])
        return d


def backfill(db: Session, *, batch_size: int = 200, apply: bool = False, limit: int | None = None) -> Report:
    """Encrypt rows that have no ciphertext yet. Safe to repeat; ids only in the report."""
    if account_email.mode() == "off":
        raise SystemExit("EMAIL_ENCRYPTION_MODE is 'off': set 'dual' (and the keys) before backfilling.")
    report = Report(total=db.scalar(select(func.count()).select_from(User)) or 0)
    report.already_encrypted = (
        db.scalar(select(func.count()).select_from(User).where(User.email_ciphertext.is_not(None))) or 0
    )
    last_id, processed = 0, 0
    while True:
        rows = list(
            db.scalars(
                select(User)
                .where(User.email_ciphertext.is_(None), User.id > last_id)
                .order_by(User.id)
                .limit(batch_size)
            )
        )
        if not rows:
            break
        for user in rows:
            last_id = user.id
            if limit is not None and processed >= limit:
                return report
            processed += 1
            if account_email.is_masked(user.email):
                report.skipped_masked.append(user.id)
                continue
            try:
                normalised = normalize_email(user.email)
            except InvalidEmail:
                report.skipped_invalid.append(user.id)
                continue
            try:
                sealed = account_email.seal(user.id, normalised)
            except (CryptoConfigError, Exception) as exc:  # noqa: BLE001 - report, never leak
                report.failures.append(user.id)
                print(f"user id={user.id}: could not encrypt ({type(exc).__name__})", file=sys.stderr)
                continue
            if not apply:
                report.encrypted += 1  # would be encrypted
                continue
            try:
                with db.begin_nested():
                    for column, value in sealed.items():
                        setattr(user, column, value)
                    db.flush()
                report.encrypted += 1
            except IntegrityError:
                report.conflicts.append(user.id)
                db.expire(user)
        if apply:
            db.commit()
    return report


def verify(db: Session) -> Report:
    """Decrypt every encrypted row and cross-check the plaintext and the blind index."""
    report = Report(total=db.scalar(select(func.count()).select_from(User)) or 0)
    bidx = account_email.blind_index()
    for user in db.scalars(select(User).where(User.email_ciphertext.is_not(None)).order_by(User.id)):
        report.already_encrypted += 1
        try:
            plain = account_email.cipher().decrypt(user.email_ciphertext, aad=account_email.aad_for(user.id))
            ok = (
                user.email_blind_index == bidx.index(account_email.PURPOSE, normalize_email(plain), user.email_bidx_version)
                and (account_email.is_masked(user.email) or normalize_email(user.email) == plain)
            )
        except (DecryptionError, CryptoConfigError, InvalidEmail, KeyError):
            ok = False
        if ok:
            report.verified_ok += 1
        else:
            report.verify_failed.append(user.id)
    return report


def rekey(db: Session, *, batch_size: int = 200, apply: bool = False) -> Report:
    """Re-encrypt and re-index rows written under an older key version with the ACTIVE keys.

    Run this after adding a new key and switching the active version, before retiring the
    old key. Additive: it only rewrites the encrypted columns, never the plaintext.
    """
    report = Report(total=db.scalar(select(func.count()).select_from(User)) or 0)
    c, b = account_email.cipher(), account_email.blind_index()
    last_id = 0
    while True:
        rows = list(
            db.scalars(
                select(User).where(User.email_ciphertext.is_not(None), User.id > last_id).order_by(User.id).limit(batch_size)
            )
        )
        if not rows:
            break
        for user in rows:
            last_id = user.id
            report.already_encrypted += 1
            if user.email_key_version == c.active_version and user.email_bidx_version == b.active_version:
                continue
            try:
                plain = c.decrypt(user.email_ciphertext, aad=account_email.aad_for(user.id))
                sealed = account_email.seal(user.id, normalize_email(plain))
            except Exception as exc:  # noqa: BLE001 - never leak
                report.failures.append(user.id)
                print(f"user id={user.id}: could not re-key ({type(exc).__name__})", file=sys.stderr)
                continue
            if apply:
                try:
                    with db.begin_nested():
                        for column, value in sealed.items():
                            setattr(user, column, value)
                        db.flush()
                except IntegrityError:
                    report.conflicts.append(user.id)
                    db.expire(user)
                    continue
            report.encrypted += 1
        if apply:
            db.commit()
    return report


def scrub(db: Session, *, batch_size: int = 200, apply: bool = False) -> Report:
    """Replace the plaintext of VERIFIED rows with a placeholder. Destructive; see module docstring."""
    report = verify(db)
    if report.verify_failed:
        raise SystemExit(f"Refusing to scrub: {len(report.verify_failed)} row(s) do not verify (ids: {report.verify_failed[:10]}).")
    remaining = db.scalar(
        select(func.count()).select_from(User).where(User.email_ciphertext.is_(None))
    ) or 0
    if remaining:
        print(f"{remaining} row(s) have no encrypted email and keep their plaintext (masked or invalid rows).", file=sys.stderr)
    while apply:
        rows = list(
            db.scalars(
                select(User)
                .where(User.email_ciphertext.is_not(None), ~User.email.like("%@" + account_email.MASK_DOMAIN))
                .order_by(User.id)
                .limit(batch_size)
            )
        )
        if not rows:
            break
        for user in rows:
            user.email = account_email.masked_placeholder(user.id)
            report.scrubbed += 1
        db.commit()
    return report


def _engine():
    from app.database.target_guard import UnsafeDatabaseTarget, check_target

    url = normalize_database_url(settings.database_direct_url or settings.database_url)
    try:
        target = check_target(url, app_env=settings.app_env, command="data-script")
    except UnsafeDatabaseTarget as exc:
        raise SystemExit(str(exc)) from None
    print(f"Target: {target.description}", file=sys.stderr)
    kwargs = {} if url.get_backend_name() == "sqlite" else {"connect_args": {"sslmode": settings.database_ssl_mode}}
    return create_engine(url, **kwargs)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", nargs="?", default="backfill", choices=["backfill", "verify", "rekey", "scrub"])
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    ap.add_argument("--batch-size", type=int, default=200)
    ap.add_argument("--limit", type=int, default=None, help="stop after N rows (for a small first run)")
    ap.add_argument("--report", type=Path, help="write the JSON report (counts and ids only) to this file")
    ap.add_argument("--i-have-a-verified-backup", action="store_true", help="required for scrub --apply")
    args = ap.parse_args()

    problems = settings.validate_email_encryption()
    if problems:
        raise SystemExit("; ".join(problems))
    if args.command == "scrub" and args.apply and not args.i_have_a_verified_backup:
        raise SystemExit("scrub --apply replaces plaintext emails. Take and verify a backup, then pass --i-have-a-verified-backup.")

    with Session(_engine()) as db:
        if args.command == "backfill":
            report = backfill(db, batch_size=args.batch_size, apply=args.apply, limit=args.limit)
            print(("APPLIED" if args.apply else "DRY RUN (nothing written)"))
        elif args.command == "verify":
            report = verify(db)
        elif args.command == "rekey":
            report = rekey(db, batch_size=args.batch_size, apply=args.apply)
            print(("APPLIED" if args.apply else "DRY RUN (nothing written)"))
        else:
            report = scrub(db, batch_size=args.batch_size, apply=args.apply)
            print(("SCRUBBED" if args.apply else "DRY RUN (nothing written)"))
    out = json.dumps(report.summary(), indent=2)
    print(out)
    if args.report:
        args.report.write_text(out)
    return 1 if (report.failures or report.verify_failed) else 0


if __name__ == "__main__":
    raise SystemExit(main())
