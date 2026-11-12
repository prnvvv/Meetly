"""Copy a SQLite Meetly database into PostgreSQL and validate the result.

    python scripts/migrate_sqlite_to_postgres.py --source data/backups/x.db --schema rehearsal --create-schema
    python scripts/migrate_sqlite_to_postgres.py --source data/backups/x.db            # into public (must be empty)

Safety rules:
* The SQLite file is opened READ-ONLY and never modified.
* The target comes from DATABASE_DIRECT_URL (session pooler / direct), never the
  transaction pooler.
* The target schema must contain the tables and be EMPTY, otherwise it refuses.
  With --create-schema it builds the tables in a throwaway schema (rehearsal only;
  the real schema is created by ``alembic upgrade head``).
* One transaction: any failure rolls everything back.
* Primary keys are preserved; sequences are advanced afterwards.
* Validation compares row counts, every row's content, FK orphans and per-meeting
  participant counts, and exits non-zero on any difference.
* --drop-schema removes a rehearsal schema afterwards (refuses for ``public``).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, func, select, text  # noqa: E402

import app.models  # noqa: E402,F401
from app.config import settings  # noqa: E402
from app.database.database import Base, normalize_database_url  # noqa: E402


def _sqlite_engine(path: Path):
    if not path.is_file():
        raise SystemExit(f"Source database not found: {path}")
    return create_engine(f"sqlite:///file:{path.as_posix()}?mode=ro&uri=true")


def _rows(conn, table):
    pk = [c.name for c in table.primary_key.columns]
    return [dict(r._mapping) for r in conn.execute(select(table).order_by(*[table.c[c] for c in pk]))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--schema", default="public")
    ap.add_argument("--create-schema", action="store_true", help="rehearsal only: create tables in the schema")
    ap.add_argument("--drop-schema", action="store_true", help="drop a rehearsal schema afterwards")
    args = ap.parse_args()

    if args.schema == "public" and (args.create_schema or args.drop_schema):
        raise SystemExit("Refusing to create/drop the public schema; use alembic for it.")
    if not settings.database_direct_url:
        raise SystemExit("Set DATABASE_DIRECT_URL (session pooler or direct) in backend/.env")

    src = _sqlite_engine(args.source)
    dst = create_engine(
        normalize_database_url(settings.database_direct_url),
        connect_args={"sslmode": settings.database_ssl_mode},
    ).execution_options(schema_translate_map={None: args.schema})
    tables = Base.metadata.sorted_tables
    ok = True

    with dst.connect() as probe:
        if args.create_schema:
            probe.execute(text(f'DROP SCHEMA IF EXISTS "{args.schema}" CASCADE'))
            probe.execute(text(f'CREATE SCHEMA "{args.schema}"'))
            probe.commit()
            Base.metadata.create_all(probe)
            probe.commit()

    with src.connect() as s, dst.begin() as d:
        for t in tables:
            n = d.execute(select(func.count()).select_from(t)).scalar_one()
            if n:
                raise SystemExit(f"Target table {args.schema}.{t.name} is not empty ({n} rows); refusing.")

        data = {t.name: _rows(s, t) for t in tables}
        for t in tables:
            if data[t.name]:
                d.execute(t.insert(), data[t.name])
            print(f"copied {t.name:16s} {len(data[t.name]):6d} rows")

        for t in tables:
            pk = list(t.primary_key.columns)
            if len(pk) == 1 and pk[0].autoincrement is not False and pk[0].type.python_type is int:
                d.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence(:tbl, :col), "
                        f"COALESCE((SELECT MAX({pk[0].name}) FROM \"{args.schema}\".\"{t.name}\"), 1), "
                        f"(SELECT MAX({pk[0].name}) FROM \"{args.schema}\".\"{t.name}\") IS NOT NULL)"
                    ),
                    {"tbl": f'"{args.schema}"."{t.name}"', "col": pk[0].name},
                )

        print("\n== validation ==")
        for t in tables:
            got = _rows(d, t)
            same = got == data[t.name]
            ok &= same
            print(f"{t.name:16s} src={len(data[t.name]):5d} dst={len(got):5d} content_equal={same}")

        for t in tables:
            for fk in t.foreign_key_constraints:
                child = fk.columns[0]
                parent = fk.elements[0].column
                orphans = d.execute(
                    select(func.count()).select_from(t).where(
                        child.is_not(None), ~child.in_(select(parent))
                    )
                ).scalar_one()
                ok &= orphans == 0
                print(f"fk {t.name}.{child.name}->{parent.table.name}: orphans={orphans}")

        mp = Base.metadata.tables["participants"]
        per_src = {}
        for r in data["participants"]:
            per_src[r["meeting_id"]] = per_src.get(r["meeting_id"], 0) + 1
        per_dst = dict(d.execute(select(mp.c.meeting_id, func.count()).group_by(mp.c.meeting_id)).all())
        same = per_src == per_dst
        ok &= same
        print(f"participants per meeting equal: {same}")

        if not ok:
            d.rollback()
            print("\nVALIDATION FAILED: transaction rolled back.")
            return 1
    print("\nVALIDATION PASSED (committed).")

    if args.drop_schema:
        with dst.connect() as c:
            c.execute(text(f'DROP SCHEMA "{args.schema}" CASCADE'))
            c.commit()
        print(f"rehearsal schema '{args.schema}' dropped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
