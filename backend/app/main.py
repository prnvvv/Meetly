from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.database.database import init_db
from app.observability import RequestIdMiddleware, configure_logging, install_exception_handlers
from app.security.http import BodySizeLimitMiddleware, SecurityHeadersMiddleware

logger = logging.getLogger(__name__)


def _end_empty_once(live_ids: set[str], live_participants: set[int] | None = None) -> list[str]:
    from app.database import SessionLocal
    from app.services import lifecycle_service

    grace = timedelta(minutes=settings.empty_meeting_grace_minutes)
    with SessionLocal() as db:
        if live_participants is not None:
            # Rows left "present" by a crash or restart first, so their meeting can count as empty.
            lifecycle_service.reconcile_ghost_participants(db, grace=grace, live_participant_ids=live_participants)
        return lifecycle_service.end_empty_meetings(db, grace=grace, live_meeting_ids=live_ids)


async def _sweep_empty_meetings() -> None:
    """Periodically end active meetings that nobody is in (see lifecycle_service)."""
    from app.websocket.manager import get_manager

    while True:
        await asyncio.sleep(settings.empty_meeting_sweep_seconds)
        try:
            manager = get_manager()
            live_ids = await manager.live_meeting_ids()
            live_participants = await manager.live_participant_ids()
            await run_in_threadpool(_end_empty_once, live_ids, live_participants)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("empty-meeting sweep failed")


@asynccontextmanager
async def _lifespan(application: FastAPI):
    # Create the SQLite schema and the demo user before the first request.
    # Without this a fresh database answers every database route with
    # "no such table" instead of starting from an empty schema. Failures
    # propagate so a broken database is not served silently.
    problems = settings.validate_for_production() + settings.validate_email_encryption()
    if problems:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))
    await run_in_threadpool(init_db)
    logger.info(
        "Realtime server ready (stun=%s, origins=%s)",
        settings.stun_server,
        settings.cors_origins,
    )
    sweeper = None
    if settings.empty_meeting_grace_minutes > 0:
        sweeper = asyncio.create_task(_sweep_empty_meetings())
    try:
        yield
    finally:
        if sweeper is not None:
            sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sweeper


def create_app() -> FastAPI:
    configure_logging(settings.app_env)
    application = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        lifespan=_lifespan,
    )

    # Bearer tokens, not cookies: no credentialed requests are needed, so none are allowed.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
        max_age=600,
    )
    application.add_middleware(BodySizeLimitMiddleware)
    application.add_middleware(SecurityHeadersMiddleware)
    application.add_middleware(RequestIdMiddleware)  # outermost: every response and log line carries the id
    install_exception_handlers(application)

    _include_routers(application)

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/health/live")
    async def live() -> dict[str, str]:
        """The process is up. Never touches the database, so a database outage cannot restart-loop the API."""
        return {"status": "ok"}

    @application.get("/health/ready")
    async def ready() -> JSONResponse:
        """Can this instance serve traffic: database reachable and encryption configuration valid."""
        checks = await run_in_threadpool(_readiness_checks)
        ok = all(checks.values())
        return JSONResponse({"status": "ok" if ok else "unavailable", "checks": checks}, status_code=200 if ok else 503)

    return application


def _readiness_checks() -> dict[str, bool]:
    """Boolean results only: a failing check never reveals hosts, URLs or error text."""
    from sqlalchemy import text

    from app.database.database import engine

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database = True
    except Exception:  # noqa: BLE001
        logger.warning("readiness: database check failed")
        database = False
    schema = database and _schema_at_head()
    return {"database": database, "schema": schema, "encryption_config": not settings.validate_email_encryption()}


def _schema_at_head() -> bool:
    """On PostgreSQL the Alembic revision must equal the code's head (migrations are applied by an
    operator, never implicitly), so a deploy that is ahead of the database reports not-ready instead
    of failing request by request. SQLite (local/tests) is created from the models and always passes."""
    from sqlalchemy import text

    from app.database.database import engine

    if engine.dialect.name == "sqlite":
        return True
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
        head = ScriptDirectory.from_config(cfg).get_current_head()
        with engine.connect() as connection:
            current = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
        return current == head
    except Exception:  # noqa: BLE001
        logger.warning("readiness: schema revision check failed")
        return False


def _include_routers(application: FastAPI) -> None:
    """Attach participant and websocket routers plus BD1's REST routers.

    BD1's modules are imported defensively so the realtime surface can boot
    independently; missing modules are logged, not raised.
    """
    from app.routers.participants import router as participants_router

    application.include_router(participants_router)

    from app.websocket.handler import router as websocket_router

    application.include_router(websocket_router)

    from app.websocket.user_channel import router as user_channel_router

    application.include_router(user_channel_router)

    from app.routers.webrtc import router as webrtc_router

    application.include_router(webrtc_router)

    from app.routers.waiting_room import router as waiting_room_router

    application.include_router(waiting_room_router)

    from app.routers.social import routers as social_routers

    for social_router in social_routers:
        application.include_router(social_router)

    for module_name, attribute, tag in (
        ("app.routers.users", "router", "users"),
        ("app.routers.profiles", "router", "profiles"),
        ("app.routers.meetings", "router", "meetings"),
        ("app.routers.schedules", "router", "schedules"),
    ):
        router = _load_router(module_name, attribute)
        if router is not None:
            application.include_router(router)
            logger.info("Registered %s router", tag)
        else:
            logger.warning("Router %s is not available yet", module_name)


def _load_router(module_name: str, attribute: str):
    try:
        module = __import__(module_name, fromlist=[attribute])
        return getattr(module, attribute, None)
    except Exception:
        logger.warning("Could not import router from %s", module_name)
        return None


app = create_app()