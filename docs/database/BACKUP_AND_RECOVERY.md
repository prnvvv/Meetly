# Backup and recovery

## SQLite (until cutover)
- Backup: `cd backend && python scripts/backup_db.py backup` -> `data/backups/<name>-<timestamp>.db` (gitignored).
- Verify: `sqlite3 <file> "PRAGMA integrity_check"` must print `ok`.
- Restore: `python scripts/backup_db.py restore BACKUP.db NEW.db` (never overwrites), stop the app, swap the file in.

## Supabase PostgreSQL
- Provider backups: depends on the Supabase plan. **Verify in Dashboard -> Database -> Backups** which applies to this project (daily backups are a paid-plan feature; point-in-time recovery is a paid add-on). Do not assume them on a free project. Supabase encrypts storage and backups with provider-managed keys; Meetly does not hold those keys.
- Own backup (works on every plan): `pg_dump "$DATABASE_DIRECT_URL" -Fc -f meetly-$(date +%F).dump` (needs PostgreSQL client tools; use the session pooler URL). Dumps are plaintext-equivalent to the database: store them encrypted and outside git (`*.dump` is gitignored).
- Restore into an empty database: `pg_restore --no-owner -d "$TARGET_URL" meetly-YYYY-MM-DD.dump`, then `python -m alembic current` must show the latest revision.
- Field-encrypted columns are only readable with the matching `FIELD_ENCRYPTION_KEYS`; back those keys up separately in a password manager. Losing them makes the encrypted values unrecoverable.
- Test a restore into a scratch project before relying on any backup.
