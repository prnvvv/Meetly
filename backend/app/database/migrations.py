"""Additive, idempotent schema migrations for existing databases.

``Base.metadata.create_all`` creates tables that do not exist yet but never
adds a column to one that does. Every migration here therefore only *adds*
(columns, indexes); nothing is dropped, renamed or rewritten, and each step is
skipped when it has already been applied, so running them on every start is safe.
Back up the database file before upgrading an existing deployment.
"""

from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# (table, column, DDL type) — nullable or defaulted so existing rows stay valid.
# Keep this list in step with the Alembic revisions: SQLite databases created before Alembic
# (local development and today's production file) are brought up to date by this function
# at start-up, and tables that did not exist at all are created by ``create_all``.
ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("users", "clerk_id", "VARCHAR(255)"),
    ("users", "last_login_at", "DATETIME"),
    ("users", "preferences", "TEXT"),
    ("meetings", "settings", "TEXT"),
    # revision 0006: waiting room (existing meetings stay OFF)
    ("meetings", "waiting_room_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
    ("meetings", "admission_mode", "VARCHAR(24) NOT NULL DEFAULT 'host_approval'"),
    # revision 0009: encrypted email columns (all nullable)
    ("users", "email_ciphertext", "TEXT"),
    ("users", "email_key_version", "VARCHAR(16)"),
    ("users", "email_blind_index", "VARCHAR(64)"),
    ("users", "email_bidx_version", "VARCHAR(16)"),
)

# (index name, table, column) — unique indexes allow many NULLs on SQLite.
ADDED_UNIQUE_INDEXES: tuple[tuple[str, str, str], ...] = (
    ("uq_users_clerk_id", "users", "clerk_id"),
)

# (index name, table, columns, WHERE clause, duplicate-check SQL or None). Partial unique indexes.
# If existing rows already violate a new uniqueness rule the index is skipped with a warning
# instead of failing start-up or changing data (merging rows is a human decision).
ADDED_PARTIAL_UNIQUE_INDEXES: tuple[tuple[str, str, str, str, str | None], ...] = (
    (
        "uq_users_email_blind_index",
        "users",
        '"email_blind_index"',
        '"email_blind_index" IS NOT NULL',
        None,
    ),
    (
        "uq_participants_meeting_user",  # revision 0007
        "participants",
        '"meeting_id", "user_id"',
        '"user_id" IS NOT NULL',
        'SELECT 1 FROM "participants" WHERE "user_id" IS NOT NULL '
        'GROUP BY "meeting_id", "user_id" HAVING COUNT(*) > 1 LIMIT 1',
    ),
)


def apply_migrations(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        for table, column, ddl_type in ADDED_COLUMNS:
            if table not in existing_tables:
                continue
            columns = {c["name"] for c in inspect(connection).get_columns(table)}
            if column in columns:
                continue
            connection.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl_type}'))
            logger.info("Migration: added %s.%s", table, column)
        for name, table, column in ADDED_UNIQUE_INDEXES:
            if table not in existing_tables:
                continue
            indexes = {i["name"] for i in inspect(connection).get_indexes(table)}
            if name not in indexes:
                connection.execute(
                    text(f'CREATE UNIQUE INDEX IF NOT EXISTS "{name}" ON "{table}" ("{column}")')
                )
                logger.info("Migration: created index %s", name)
        for name, table, columns, where, duplicate_sql in ADDED_PARTIAL_UNIQUE_INDEXES:
            if table not in existing_tables:
                continue
            indexes = {i["name"] for i in inspect(connection).get_indexes(table)}
            if name in indexes:
                continue
            if duplicate_sql and connection.execute(text(duplicate_sql)).first() is not None:
                logger.warning(
                    "Migration: existing duplicate rows prevent unique index %s on %s; left uncreated "
                    "(resolve the duplicates, then restart)",
                    name,
                    table,
                )
                continue
            connection.execute(
                text(f'CREATE UNIQUE INDEX IF NOT EXISTS "{name}" ON "{table}" ({columns}) WHERE {where}')
            )
            logger.info("Migration: created index %s", name)
