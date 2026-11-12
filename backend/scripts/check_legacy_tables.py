"""Read-only: how many rows do the unused legacy tables hold? (invitations, activity_events)

    python scripts/check_legacy_tables.py                      # the configured database
    python scripts/check_legacy_tables.py --sqlite path/to.db  # a SQLite backup (opened read-only)

Run this against the fresh production backup before anyone decides what to do with the tables.
It never writes anything.
"""

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TABLES = ("invitations", "activity_events")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", type=Path, help="a SQLite database file to inspect read-only")
    args = ap.parse_args()
    if args.sqlite:
        conn = sqlite3.connect(f"file:{args.sqlite.as_posix()}?mode=ro", uri=True)
        counts = {}
        for t in TABLES:
            try:
                counts[t] = conn.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
            except sqlite3.OperationalError:
                counts[t] = "table missing"
        print("source:", args.sqlite)
    else:
        from sqlalchemy import create_engine, text

        from app.config import settings
        from app.database.database import normalize_database_url
        from app.database.target_guard import UnsafeDatabaseTarget, check_target

        url = normalize_database_url(settings.database_direct_url or settings.database_url)
        try:
            target = check_target(url, app_env=settings.app_env, command="runtime")  # read-only: no confirmation needed
        except UnsafeDatabaseTarget as exc:
            raise SystemExit(str(exc)) from None
        print("source:", target.description)
        kwargs = {} if url.get_backend_name() == "sqlite" else {"connect_args": {"sslmode": settings.database_ssl_mode}}
        with create_engine(url, **kwargs).connect() as conn:
            counts = {}
            for t in TABLES:
                try:
                    counts[t] = conn.execute(text(f'SELECT count(*) FROM "{t}"')).scalar()
                except Exception:  # noqa: BLE001
                    counts[t] = "table missing"
    for table, n in counts.items():
        print(f"  {table:16s} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
