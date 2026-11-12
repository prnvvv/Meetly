from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.database.database import init_db

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(application: FastAPI):
    # Create the SQLite schema and the demo user before the first request.
    # Without this a fresh database answers every database route with
    # "no such table" instead of starting from an empty schema. Failures
    # propagate so a broken database is not served silently.
    problems = settings.validate_for_production()
    if problems:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))
    await run_in_threadpool(init_db)
    logger.info(
        "Realtime server ready (stun=%s, origins=%s)",
        settings.stun_server,
        settings.cors_origins,
    )
    yield
    # No teardown required; the engine is shared and sessions close themselves.


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        lifespan=_lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    _include_routers(application)

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return application


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