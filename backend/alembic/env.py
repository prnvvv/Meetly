"""Alembic environment.

Uses the direct/session-pooler URL (``DATABASE_DIRECT_URL``) when set, because
DDL must not run through the transaction pooler. Falls back to ``DATABASE_URL``.
The URL comes only from the environment and is never logged.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.config import settings
from app.database.database import Base, DATABASE_URL, normalize_database_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _url():
    if settings.database_direct_url:
        return normalize_database_url(settings.database_direct_url)
    return normalize_database_url(DATABASE_URL)


def run_migrations_offline() -> None:
    context.configure(
        url=_url().render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _url()
    kwargs = {"poolclass": pool.NullPool}
    if url.get_backend_name() != "sqlite":
        kwargs["connect_args"] = {"sslmode": settings.database_ssl_mode}
    engine = create_engine(url, **kwargs)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=url.get_backend_name() == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
