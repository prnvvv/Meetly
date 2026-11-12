"""SQLAlchemy engine, declarative Base and database initialisation."""

import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.engine import Engine, URL, make_url
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.types import TypeDecorator

DEFAULT_DATABASE_URL = "sqlite:///./data/zoom_clone.db"

# Anchors relative SQLite paths so the database always lives inside
# ``backend/data`` regardless of the directory the app is started from.
BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _resolve_database_url() -> str:
    """Use config/settings.py when it exists, then the env var, then default."""
    try:
        from app.config.settings import settings  # type: ignore[import-not-found]

        url = getattr(settings, "DATABASE_URL", None) or getattr(
            settings, "database_url", None
        )
        if url:
            return str(url)
    except ImportError:
        pass
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def normalize_database_url(raw: str) -> URL:
    """Parse a URL and select the psycopg 3 driver for bare PostgreSQL URLs.

    Supabase hands out ``postgresql://`` / ``postgres://`` strings; SQLAlchemy
    would otherwise pick the legacy psycopg2 driver.
    """
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    url = make_url(raw)
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg")
    return url


_url = normalize_database_url(_resolve_database_url())
_is_sqlite = _url.get_backend_name() == "sqlite"


def _resolve_sqlite_url(url: URL) -> URL:
    """Anchor a file-based SQLite path to ``backend/`` and create its folder.

    Absolute paths, other backends and in-memory URLs are returned unchanged.
    """
    if not _is_sqlite or not url.database or url.database == ":memory:":
        return url

    path = Path(url.database).expanduser()
    if not path.is_absolute():
        path = BACKEND_ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)
    # as_posix() keeps Windows drive paths valid inside a SQLite URL.
    return url.set(database=path.as_posix())


_resolved_url = _resolve_sqlite_url(_url)
DATABASE_URL = str(_resolved_url)


class Base(DeclarativeBase):
    """Single declarative base shared by every model."""


class UTCDateTime(TypeDecorator):
    """Timezone-aware UTC datetimes (TIMESTAMPTZ on PostgreSQL; SQLite drops tzinfo).

    Values are stored as naive UTC and always returned as aware UTC, so the
    REST layer can serialise consistent ISO 8601 strings.
    """

    impl = DateTime
    cache_ok = True

    def load_dialect_impl(self, dialect):
        # PostgreSQL gets a real TIMESTAMPTZ; SQLite has no such type.
        return dialect.type_descriptor(DateTime(timezone=dialect.name != "sqlite"))

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive datetime not allowed; use timezone-aware UTC.")
        utc = value.astimezone(timezone.utc)
        return utc.replace(tzinfo=None) if dialect.name == "sqlite" else utc

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def build_engine_kwargs(url: URL) -> dict:
    """Engine options per backend. Never put credentials or the URL in logs."""
    from app.config import settings

    if url.get_backend_name() == "sqlite":
        return {"connect_args": {"check_same_thread": False}}
    connect_args: dict = {"sslmode": settings.database_ssl_mode}
    kwargs: dict = {"pool_pre_ping": True, "pool_recycle": 1800}
    if settings.database_use_pooler:
        # Transaction pooler (PgBouncer): prepared statements do not survive
        # between transactions, so the driver must not create them.
        connect_args["prepare_threshold"] = None
    kwargs["pool_size"] = settings.database_pool_size
    kwargs["max_overflow"] = settings.database_max_overflow
    kwargs["connect_args"] = connect_args
    return kwargs


engine: Engine = create_engine(_resolved_url, **build_engine_kwargs(_resolved_url))

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _record) -> None:
        # SQLite ignores foreign keys unless enabled per connection.
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        # WAL lets readers run while one writer commits; the busy timeout makes a
        # second writer wait instead of failing with "database is locked".
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.close()


def _install_rls_hook() -> None:
    """Start each transaction of an RLS-bound session as the app role with the user id set."""
    from sqlalchemy.orm import Session as OrmSession

    from app.database.rls import ROLE

    @event.listens_for(OrmSession, "after_begin")
    def _apply_rls_context(session, _transaction, connection) -> None:
        user_id = session.info.get("rls_user_id")
        if user_id is None or connection.dialect.name != "postgresql":
            return
        from app.config import settings

        if not settings.database_rls_enforce:
            return
        connection.exec_driver_sql("SELECT set_config('app.user_id', %s, true)", (str(int(user_id)),))
        connection.exec_driver_sql(f"SET LOCAL ROLE {ROLE}")


_install_rls_hook()


def init_db() -> None:
    """Prepare the database at startup. Safe to repeat.

    SQLite (local dev and tests) keeps the historical behaviour: create missing
    tables and additive columns, and seed the demo user. PostgreSQL schemas are
    owned by Alembic (``alembic upgrade head``), never created implicitly by the
    running app, so here we only verify that the database is reachable.
    """
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    if not _is_sqlite:
        from app.config import settings
        from app.database.target_guard import check_target

        check_target(_resolved_url, app_env=settings.app_env, command="runtime")
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return

    import app.models  # noqa: F401  (registers tables on Base.metadata)
    from app.models.user import DEMO_USER_EMAIL, DEMO_USER_ID, DEMO_USER_NAME, User

    from app.database.migrations import apply_migrations

    # create_all only creates missing tables; it never alters or drops anything.
    Base.metadata.create_all(bind=engine)
    apply_migrations(engine)
    with Session(engine) as db:
        if db.get(User, DEMO_USER_ID) is None:
            db.add(User(id=DEMO_USER_ID, name=DEMO_USER_NAME, email=DEMO_USER_EMAIL))
            db.commit()
