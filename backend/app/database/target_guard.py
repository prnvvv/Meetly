"""Which database is this process about to touch? Refuse when that is not what was intended.

Why this exists: a migration command once ran against the only configured Supabase
project, not the scratch schema it was meant for (see docs/database/INCIDENT_2026-11-12).
Every environment is therefore bound to ONE database identity, and commands that change
a shared database must be told, explicitly, which one they expect.

Settings (all environment variables):

``DATABASE_TARGET_ENV``      development | staging | production (names this database)
``DATABASE_EXPECTED_REF``    the Supabase project ref this environment may use
``MEETLY_CONFIRM_DB``        per-command confirmation: must equal the project ref

Rules for non-SQLite databases:
* The connected project ref must equal ``DATABASE_EXPECTED_REF`` (a missing value refuses).
* ``DATABASE_TARGET_ENV`` must agree with ``APP_ENV`` (local <-> development).
* staging and production additionally need ``MEETLY_CONFIRM_DB=<ref>`` for any schema or
  data command (alembic, migration scripts). The running API only needs the ref match.
* Downgrades are refused everywhere except development with ``ALEMBIC_ALLOW_DOWNGRADE=1``.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from sqlalchemy.engine import URL

_REF_FROM_HOST = re.compile(r"^db\.([a-z0-9]{20})\.supabase\.co$")

_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}

APP_ENV_TO_TARGET ={"local": "development", "test": "development", "development": "development",
                     "staging": "staging", "production": "production"}


class UnsafeDatabaseTarget(RuntimeError):
    """The database in use is not the one this environment is allowed to touch."""


@dataclass(frozen=True)
class DatabaseTarget:
    backend: str
    host: str
    ref: str | None
    description: str

    @property
    def is_sqlite(self) -> bool:
        return self.backend == "sqlite"


def describe(url: URL) -> DatabaseTarget:
    backend = url.get_backend_name()
    if backend == "sqlite":
        return DatabaseTarget("sqlite", "", None, f"SQLite file {url.database or ':memory:'}")
    host = url.host or ""
    username = url.username or ""
    ref = None
    if "." in username:  # pooler logins look like postgres.<project-ref>
        ref = username.split(".", 1)[1]
    else:
        match = _REF_FROM_HOST.match(host)
        ref = match.group(1) if match else None
    return DatabaseTarget(backend, host, ref, f"{backend} {host} (project ref: {ref or 'unknown'})")


def check_target(
    url: URL,
    *,
    app_env: str,
    command: str = "runtime",
    env: dict[str, str] | None = None,
) -> DatabaseTarget:
    """Raise ``UnsafeDatabaseTarget`` unless using this database now is clearly intended.

    ``command`` is ``runtime`` for the API, anything else (``alembic``, ``data-script``)
    is a command that changes a shared database.
    """
    env = os.environ if env is None else env
    target = describe(url)
    if target.is_sqlite:
        return target
    # A database on this machine (a CI service container, a local Docker Postgres) is never
    # a shared Supabase project, so there is no identity to bind. Not allowed in production.
    if target.host in _LOOPBACK_HOSTS and app_env.lower() != "production":
        return target

    expected_ref = (env.get("DATABASE_EXPECTED_REF") or "").strip()
    target_env = (env.get("DATABASE_TARGET_ENV") or "").strip().lower()
    where = target.description

    if not expected_ref:
        raise UnsafeDatabaseTarget(
            f"Refusing to use {where}: DATABASE_EXPECTED_REF is not set. Set it to the project "
            "ref this environment is allowed to use (docs/database/ENVIRONMENTS_AND_MIGRATIONS.md)."
        )
    if target.ref != expected_ref:
        raise UnsafeDatabaseTarget(
            f"Refusing to use {where}: this environment expects project ref '{expected_ref}'. "
            "The URL points at a different database."
        )
    if target_env not in ("development", "staging", "production"):
        raise UnsafeDatabaseTarget(
            "DATABASE_TARGET_ENV must be development, staging or production when a shared "
            "database is configured."
        )
    expected_target = APP_ENV_TO_TARGET.get(app_env.lower(), "development")
    if target_env != expected_target:
        raise UnsafeDatabaseTarget(
            f"APP_ENV={app_env} expects a {expected_target} database but DATABASE_TARGET_ENV="
            f"{target_env}. Refusing to mix environments."
        )
    if command != "runtime" and target_env in ("staging", "production"):
        if (env.get("MEETLY_CONFIRM_DB") or "").strip() != target.ref:
            raise UnsafeDatabaseTarget(
                f"'{command}' changes the {target_env} database ({where}). Re-run with "
                f"MEETLY_CONFIRM_DB={target.ref} to confirm that this is the database you mean."
            )
    return target


def check_downgrade_allowed(url: URL, *, env: dict[str, str] | None = None) -> None:
    """A downgrade drops tables and data. Only a development database, on request."""
    env = os.environ if env is None else env
    target = describe(url)
    if target.is_sqlite:
        return
    if (env.get("DATABASE_TARGET_ENV") or "").lower() != "development":
        raise UnsafeDatabaseTarget(
            f"Downgrade refused for {target.description}: only a development database may be "
            "downgraded."
        )
    if env.get("ALEMBIC_ALLOW_DOWNGRADE") != "1":
        raise UnsafeDatabaseTarget(
            f"Downgrade refused for {target.description}: it would DROP tables and delete data. "
            "Use a throwaway database, or set ALEMBIC_ALLOW_DOWNGRADE=1 on a development "
            "database you are happy to lose."
        )
