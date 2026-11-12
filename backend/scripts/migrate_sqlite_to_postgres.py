"""Copy a Meetly SQLite database into PostgreSQL, validate it, and write an auditable report.

    # 1. rehearsal in a throwaway schema (safe anywhere; the schema is dropped afterwards)
    python scripts/migrate_sqlite_to_postgres.py --source backup.db --schema rehearsal --create-schema --drop-schema --apply
    # 2. dry run against the real target schema: does everything, validates, then ROLLS BACK
    python scripts/migrate_sqlite_to_postgres.py --source backup.db
    # 3. the real copy (a maintenance window, after approval, with MEETLY_CONFIRM_DB on staging/production)
    python scripts/migrate_sqlite_to_postgres.py --source backup.db --apply --report migration-report.json

Guarantees
* The original backup is never opened for writing: the script works on a private COPY and proves,
  with SHA-256 before and after, that the original did not change.
* Default is a DRY RUN: the full insert and validation run inside a transaction that is rolled
  back. Nothing is committed without ``--apply``.
* The target must be at the current Alembic revision and EMPTY, otherwise it stops.
* Source problems (failed integrity check, orphaned foreign keys, rows that would violate a target
  constraint) stop the run and are listed in the report. Nothing is silently dropped, repaired or
  skipped. Columns that exist in only one side are listed.
* One transaction for the whole copy; any failure rolls everything back.
* Primary keys are preserved (so are Clerk ids and every relationship); identity sequences are advanced.
* Derived data is created in the same transaction: a profile for every user (generated username) and,
  if ``EMAIL_ENCRYPTION_MODE`` is on, the encrypted email columns.
* The report holds counts, ids and hashes only: no emails, names, passwords or keys.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, func, select, text  # noqa: E402
from sqlalchemy.engine import Connection, Engine  # noqa: E402

import app.models  # noqa: E402,F401
from app.config import settings  # noqa: E402
from app.database.database import Base, normalize_database_url  # noqa: E402

# Tables that did not exist when the production SQLite file was created: nothing to copy.
DERIVED_TABLES = {
    "user_profiles", "friend_requests", "friendships", "user_blocks", "notifications",
    "meeting_invitations", "waiting_room_entries",
}


@dataclass
class Report:
    source_sha256_before: str = ""
    source_sha256_after: str = ""
    source_unchanged: bool = False
    target: str = ""
    schema: str = ""
    mode: str = "dry-run"
    committed: bool = False
    started: float = field(default_factory=time.time)
    seconds: float = 0.0
    source_tables: list[str] = field(default_factory=list)
    column_mapping: dict[str, dict] = field(default_factory=dict)
    counts: dict[str, dict] = field(default_factory=dict)
    derived: dict[str, int] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)  # anything that stopped or failed the run
    notes: list[str] = field(default_factory=list)
    checks: dict[str, bool] = field(default_factory=dict)
    merged_duplicate_participants: list[int] = field(default_factory=list)  # ids dropped in the TARGET only

    @property
    def ok(self) -> bool:
        return not self.problems and all(self.checks.values())


class Stop(Exception):
    """A pre-flight or validation failure; the run is aborted and nothing is committed."""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def open_private_copy(source: Path, workdir: Path) -> Path:
    """Copy the backup (and its WAL/SHM, if the user passed a live database) so the original is never touched."""
    if not source.is_file():
        raise SystemExit(f"Source database not found: {source}")
    copy = workdir / "source-copy.db"
    shutil.copy2(source, copy)
    for suffix in ("-wal", "-shm"):
        side = Path(str(source) + suffix)
        if side.exists():
            shutil.copy2(side, Path(str(copy) + suffix))
    return copy


def inspect_source(copy: Path, report: Report) -> dict[str, list[str]]:
    """Integrity checks plus {table: [columns]} for what actually exists in the source."""
    conn = sqlite3.connect(copy)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            report.problems.append(f"source integrity_check failed: {integrity}")
        conn.execute("PRAGMA foreign_keys=OFF")
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            by_table: dict[str, int] = {}
            for table, *_ in violations:
                by_table[table] = by_table.get(table, 0) + 1
            report.problems.append(f"source has orphaned foreign keys: {by_table}")
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {t: [r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')] for t in tables}
    finally:
        conn.close()


def plan_columns(source_cols: dict[str, list[str]], report: Report) -> dict[str, list[str]]:
    """Which columns are copied per table; everything not copied is listed in the report."""
    plan: dict[str, list[str]] = {}
    report.source_tables = sorted(source_cols)
    for table in Base.metadata.sorted_tables:
        have = source_cols.get(table.name)
        target_cols = [c.name for c in table.columns]
        if have is None:
            report.column_mapping[table.name] = {"source": "table not in source", "copied": []}
            continue
        copied = [c for c in target_cols if c in have]
        report.column_mapping[table.name] = {
            "copied": copied,
            "target_only_use_defaults": [c for c in target_cols if c not in have],
            "source_only_NOT_copied": [c for c in have if c not in target_cols],
        }
        plan[table.name] = copied
    unknown = [t for t in source_cols if t not in {tb.name for tb in Base.metadata.sorted_tables} and t != "alembic_version"]
    if unknown:
        report.notes.append(f"source tables with no target (not copied): {sorted(unknown)}")
    return plan


def read_rows(copy: Path, plan: dict[str, list[str]]) -> dict[str, list[dict]]:
    """Read through SQLAlchemy types so timestamps become aware UTC and booleans become bools."""
    engine = create_engine(f"sqlite:///{copy.as_posix()}")
    data: dict[str, list[dict]] = {}
    with engine.connect() as conn:
        for table in Base.metadata.sorted_tables:
            cols = plan.get(table.name)
            if not cols:
                data[table.name] = []
                continue
            pk = [c.name for c in table.primary_key.columns]
            stmt = select(*[table.c[c] for c in cols]).order_by(*[table.c[c] for c in pk if c in cols])
            data[table.name] = [dict(r._mapping) for r in conn.execute(stmt)]
    engine.dispose()
    return data


def find_duplicate_participants(rows: list[dict]) -> dict[tuple, list[int]]:
    seen: dict[tuple, list[int]] = {}
    for r in rows:
        if r.get("user_id") is not None:
            seen.setdefault((r["meeting_id"], r["user_id"]), []).append(r["id"])
    return {k: v for k, v in seen.items() if len(v) > 1}


def generate_profiles(users: list[dict]) -> list[dict]:
    """A profile for every user: same naming rule as the application (slug of the name, else user<id>)."""
    from app.services.profile_service import _slug
    from app.schemas.profile import RESERVED_USERNAMES

    taken: set[str] = set()
    out = []
    for u in sorted(users, key=lambda r: r["id"]):
        base = _slug(u.get("name") or "") or f"user{u['id']}"
        name, n = base, 0
        while name in taken or name in RESERVED_USERNAMES:
            n += 1
            name = f"{base[:24]}{n}"
        taken.add(name)
        now = u.get("created_at")
        out.append({
            "user_id": u["id"], "username": name, "display_name": (u.get("name") or "Meetly User")[:100],
            "visibility": "public", "show_meeting_stats": False, "created_at": now, "updated_at": now,
        })
    return out


def check_target_ready(conn: Connection, schema: str, report: Report, *, require_head: bool) -> None:
    if require_head:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        head = ScriptDirectory.from_config(Config(str(BACKEND_ROOT / "alembic.ini"))).get_current_head()
        current = conn.execute(text(f'SELECT version_num FROM "{schema}".alembic_version')).scalar() if conn.dialect.name == "postgresql" else head
        if current != head:
            raise Stop(f"target schema is at revision {current!r}, expected {head!r}: run alembic upgrade head first")
    for table in Base.metadata.sorted_tables:
        n = conn.execute(select(func.count()).select_from(table)).scalar_one()
        if n:
            raise Stop(f"target table {table.name} is not empty ({n} rows); refusing to copy into existing data")


def set_sequences(conn: Connection, schema: str) -> None:
    if conn.dialect.name != "postgresql":
        return
    for table in Base.metadata.sorted_tables:
        pk = list(table.primary_key.columns)
        if len(pk) == 1 and pk[0].autoincrement is not False and pk[0].type.python_type is int:
            conn.execute(
                text(
                    f"SELECT setval(pg_get_serial_sequence(:tbl, :col), "
                    f'COALESCE((SELECT MAX("{pk[0].name}") FROM "{schema}"."{table.name}"), 1), '
                    f'(SELECT MAX("{pk[0].name}") FROM "{schema}"."{table.name}") IS NOT NULL)'
                ),
                {"tbl": f'"{schema}"."{table.name}"', "col": pk[0].name},
            )


def encrypt_emails(conn: Connection, users: list[dict], report: Report) -> None:
    """If email encryption is on, add the encrypted columns to the copied users (plaintext untouched)."""
    from app.security.blind_index import InvalidEmail, normalize_email
    from app.services import account_email

    if account_email.mode() == "off":
        return
    users_t = Base.metadata.tables["users"]
    done = skipped = 0
    seen: set[str] = set()
    for u in users:
        if account_email.is_masked(u["email"]):
            skipped += 1
            continue
        try:
            normalised = normalize_email(u["email"])
            sealed = account_email.seal(u["id"], normalised)
        except InvalidEmail:
            skipped += 1
            continue
        if sealed["email_blind_index"] in seen:
            skipped += 1
            report.notes.append(f"user id={u['id']}: email collides with another account; left unencrypted")
            continue
        seen.add(sealed["email_blind_index"])
        conn.execute(users_t.update().where(users_t.c.id == u["id"]).values(**sealed))
        done += 1
    report.derived["emails_encrypted"] = done
    report.derived["emails_skipped"] = skipped


def validate(conn: Connection, data: dict[str, list[dict]], plan: dict[str, list[str]], report: Report) -> None:
    for table in Base.metadata.sorted_tables:
        if table.name in DERIVED_TABLES and table.name not in plan:
            continue
        cols = plan.get(table.name, [])
        pk = [c.name for c in table.primary_key.columns]
        stmt = select(*[table.c[c] for c in cols]).order_by(*[table.c[c] for c in pk if c in cols]) if cols else None
        got = [dict(r._mapping) for r in conn.execute(stmt)] if stmt is not None else []
        expected = data[table.name]
        if table.name == "participants" and report.merged_duplicate_participants:
            dropped = set(report.merged_duplicate_participants)
            expected = [r for r in expected if r["id"] not in dropped]
        report.counts[table.name] = {"source": len(data[table.name]), "target": len(got)}
        report.checks[f"{table.name}: row count"] = len(got) == len(expected)
        report.checks[f"{table.name}: content identical"] = got == expected
    # relationships
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_key_constraints:
            child, parent = fk.columns[0], fk.elements[0].column
            orphans = conn.execute(
                select(func.count()).select_from(table).where(child.is_not(None), ~child.in_(select(parent)))
            ).scalar_one()
            report.checks[f"fk {table.name}.{child.name} -> {parent.table.name}: no orphans"] = orphans == 0
    # identity and application-level integrity
    users_t = Base.metadata.tables["users"]
    src_users = {r["id"]: r.get("clerk_id") for r in data["users"]}
    got_users = {r.id: r.clerk_id for r in conn.execute(select(users_t.c.id, users_t.c.clerk_id))}
    report.checks["users: ids and Clerk ids preserved"] = src_users == got_users
    profiles_t = Base.metadata.tables["user_profiles"]
    n_profiles = conn.execute(select(func.count()).select_from(profiles_t)).scalar_one()
    report.checks["every user has exactly one profile"] = n_profiles == len(data["users"])
    part_t = Base.metadata.tables["participants"]
    per_meeting = dict(conn.execute(select(part_t.c.meeting_id, func.count()).group_by(part_t.c.meeting_id)).all())
    expected_pm: dict[int, int] = {}
    for r in data["participants"]:
        if r["id"] not in set(report.merged_duplicate_participants):
            expected_pm[r["meeting_id"]] = expected_pm.get(r["meeting_id"], 0) + 1
    report.checks["participants per meeting identical"] = per_meeting == expected_pm
    meetings_t = Base.metadata.tables["meetings"]
    report.checks["meetings: waiting room OFF for every existing meeting"] = (
        conn.execute(select(func.count()).select_from(meetings_t).where(meetings_t.c.waiting_room_enabled.is_(True))).scalar_one() == 0
    )
    for name, column in (("meetings", "settings"), ("users", "preferences")):
        bad = 0
        for r in data[name]:
            raw = r.get(column)
            if raw:
                try:
                    json.loads(raw)
                except ValueError:
                    bad += 1
        report.checks[f"{name}.{column}: valid JSON text"] = bad == 0


def copy_database(
    source: Path,
    target: Engine,
    *,
    schema: str = "public",
    apply: bool = False,
    merge_duplicate_participants: bool = False,
    require_head: bool = True,
    create_tables: bool = False,
) -> Report:
    """Run the whole procedure; returns the report. Commits only with ``apply`` and only if every check passed."""
    report = Report(mode="apply" if apply else "dry-run", schema=schema, target=str(target.url.render_as_string(hide_password=True)))
    report.source_sha256_before = sha256(source)
    with tempfile.TemporaryDirectory(prefix="meetly-migration-") as work:
        copy = open_private_copy(source, Path(work))
        try:
            source_cols = inspect_source(copy, report)
        except sqlite3.DatabaseError as exc:
            report.problems.append(f"source database cannot be read ({exc}); it is damaged or not a SQLite file")
            return _finish(report, source)
        if report.problems:
            return _finish(report, source)
        plan = plan_columns(source_cols, report)
        data = read_rows(copy, plan)

        dupes = find_duplicate_participants(data["participants"])
        if dupes:
            ids = sorted(i for group in dupes.values() for i in group[1:])
            if merge_duplicate_participants:
                report.merged_duplicate_participants = ids
                report.notes.append(f"kept the first participant row per (meeting, user); {len(ids)} duplicate row(s) NOT copied (ids in report)")
            else:
                report.problems.append(
                    f"{len(dupes)} (meeting, user) pair(s) have several participant rows, which the target forbids "
                    f"(row ids to review: {ids}). Re-run with --merge-duplicate-participants to keep the first row of each."
                )
                return _finish(report, source)

        conn = target.connect()
        trans = conn.begin()
        try:
            if create_tables:
                Base.metadata.create_all(conn)
            check_target_ready(conn, schema, report, require_head=require_head and not create_tables)
            skip_ids = set(report.merged_duplicate_participants)
            for table in Base.metadata.sorted_tables:
                rows = data[table.name]
                if table.name == "participants" and skip_ids:
                    rows = [r for r in rows if r["id"] not in skip_ids]
                if rows:
                    conn.execute(table.insert(), rows)
            profiles = generate_profiles(data["users"])
            if profiles:
                conn.execute(Base.metadata.tables["user_profiles"].insert(), profiles)
            report.derived["profiles_created"] = len(profiles)
            encrypt_emails(conn, data["users"], report)
            set_sequences(conn, schema)
            validate(conn, data, plan, report)
            if not report.ok:
                failed = [k for k, v in report.checks.items() if not v]
                raise Stop(f"validation failed: {failed}")
            if apply:
                trans.commit()
                report.committed = True
            else:
                trans.rollback()
                report.notes.append("dry run: everything was inserted and validated inside a transaction that was rolled back")
        except Stop as exc:
            trans.rollback()
            report.problems.append(str(exc))
        except Exception as exc:  # noqa: BLE001 - report the type, never row data
            trans.rollback()
            report.problems.append(f"{type(exc).__name__} while copying; rolled back (no data written)")
        finally:
            conn.close()
    return _finish(report, source)


def _finish(report: Report, source: Path) -> Report:
    report.source_sha256_after = sha256(source)
    report.source_unchanged = report.source_sha256_before == report.source_sha256_after
    report.checks["original backup unchanged"] = report.source_unchanged
    report.seconds = round(time.time() - report.started, 2)
    return report


def print_report(report: Report) -> None:
    print(f"\nMode: {report.mode.upper()}   committed: {report.committed}   target: {report.target}")
    for t, c in report.counts.items():
        print(f"  {t:22s} source={c['source']:6d} target={c['target']:6d}")
    for k, v in report.derived.items():
        print(f"  derived {k}: {v}")
    for name, ok in report.checks.items():
        print(f"  [{'ok' if ok else 'FAIL'}] {name}")
    for n in report.notes:
        print(f"  note: {n}")
    for p in report.problems:
        print(f"  PROBLEM: {p}")
    print("\nRESULT:", "PASSED" if report.ok else "FAILED")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path, help="the SQLite backup (never modified)")
    ap.add_argument("--schema", default="public")
    ap.add_argument("--apply", action="store_true", help="commit (default is a dry run that rolls back)")
    ap.add_argument("--create-schema", action="store_true", help="rehearsal only: build the tables in a throwaway schema")
    ap.add_argument("--drop-schema", action="store_true", help="drop that throwaway schema afterwards")
    ap.add_argument("--merge-duplicate-participants", action="store_true")
    ap.add_argument("--report", type=Path, help="write the JSON report here (counts, ids and hashes only)")
    args = ap.parse_args()

    if args.schema == "public" and (args.create_schema or args.drop_schema):
        raise SystemExit("Refusing to create/drop the public schema; use alembic for it.")
    if not settings.database_direct_url:
        raise SystemExit("Set DATABASE_DIRECT_URL (session pooler or direct) in backend/.env")

    from app.database.target_guard import UnsafeDatabaseTarget, check_target

    url = normalize_database_url(settings.database_direct_url)
    try:
        target_info = check_target(url, app_env=settings.app_env, command="data-script")
    except UnsafeDatabaseTarget as exc:
        raise SystemExit(str(exc)) from None
    print(f"Target: {target_info.description}   schema: {args.schema}")

    engine = create_engine(url, connect_args={"sslmode": settings.database_ssl_mode}).execution_options(
        schema_translate_map={None: args.schema}
    )
    if args.create_schema:
        with engine.connect() as c:
            c.execute(text(f'DROP SCHEMA IF EXISTS "{args.schema}" CASCADE'))
            c.execute(text(f'CREATE SCHEMA "{args.schema}"'))
            c.commit()
    try:
        report = copy_database(
            args.source, engine, schema=args.schema, apply=args.apply,
            merge_duplicate_participants=args.merge_duplicate_participants, create_tables=args.create_schema,
        )
    finally:
        if args.drop_schema:
            with engine.connect() as c:
                c.execute(text(f'DROP SCHEMA IF EXISTS "{args.schema}" CASCADE'))
                c.commit()
            print(f"rehearsal schema '{args.schema}' dropped")
    print_report(report)
    if args.report:
        args.report.write_text(json.dumps(asdict(report), indent=2, default=str))
        print(f"report written to {args.report}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
