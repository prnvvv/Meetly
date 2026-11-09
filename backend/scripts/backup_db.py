"""Safe SQLite backup and restore (never overwrites an existing file).

    python scripts/backup_db.py backup                 # -> data/backups/<name>-<timestamp>.db
    python scripts/backup_db.py backup --dest /mnt/x   # another directory
    python scripts/backup_db.py restore BACKUP.db NEW_PATH.db

``backup`` uses SQLite's online backup API, so it is consistent while the app is
running (including WAL contents) and only reads the source. ``restore`` copies a
backup to a *new* path and refuses to replace an existing database; swap the
restored file into place yourself after stopping the app.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _database_path() -> Path:
    sys.path.insert(0, str(BACKEND_ROOT))
    from app.database.database import DATABASE_URL
    from sqlalchemy.engine import make_url

    url = make_url(DATABASE_URL)
    if url.get_backend_name() != "sqlite" or not url.database:
        raise SystemExit("DATABASE_URL is not a file-based SQLite database; use your provider's backup tool.")
    return Path(url.database)


def _copy(source: Path, target: Path) -> None:
    if target.exists():
        raise SystemExit(f"Refusing to overwrite existing file: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    reader = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    writer = sqlite3.connect(target)
    try:
        reader.backup(writer)
        status = writer.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        writer.close()
        reader.close()
    if status != "ok":
        target.unlink(missing_ok=True)
        raise SystemExit(f"Integrity check failed ({status}); backup discarded.")
    print(f"OK: {target}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    backup = sub.add_parser("backup")
    backup.add_argument("--dest", type=Path, default=None, help="directory for the backup file")
    restore = sub.add_parser("restore")
    restore.add_argument("backup_file", type=Path)
    restore.add_argument("new_path", type=Path)
    args = parser.parse_args()

    if args.command == "backup":
        source = _database_path()
        directory = args.dest or source.parent / "backups"
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        _copy(source, directory / f"{source.stem}-{stamp}.db")
    else:
        if not args.backup_file.exists():
            raise SystemExit(f"No such backup: {args.backup_file}")
        _copy(args.backup_file, args.new_path)


if __name__ == "__main__":
    main()
