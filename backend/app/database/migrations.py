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

# (table, column, DDL type) — nullable so existing rows stay valid.
ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("users", "clerk_id", "VARCHAR(255)"),
    ("users", "last_login_at", "DATETIME"),
    ("users", "preferences", "TEXT"),
    ("meetings", "settings", "TEXT"),
)

# (index name, table, column) — unique indexes allow many NULLs on SQLite.
ADDED_UNIQUE_INDEXES: tuple[tuple[str, str, str], ...] = (
    ("uq_users_clerk_id", "users", "clerk_id"),
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
