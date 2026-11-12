"""Per-user realtime channel (``/ws/notifications``) on the existing FastAPI WebSocket stack.

It carries tiny "something changed" events only; clients refetch over REST, so no
private data travels on the socket and a missed event is harmless (the client also
polls). Authentication is the first message (never the URL), like the meeting socket.
Services call :func:`notify_users` after committing; it is safe from worker threads.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.auth import AuthError, user_from_token
from app.database.session import SessionLocal

logger = logging.getLogger(__name__)
router = APIRouter()

AUTH_TIMEOUT_SECONDS = 10
MAX_SOCKETS_PER_USER = 5

_sockets: dict[int, set[WebSocket]] = defaultdict(set)
_loop: asyncio.AbstractEventLoop | None = None


async def _send_all(user_id: int, event: dict) -> None:
    for ws in list(_sockets.get(user_id, ())):
        try:
            await ws.send_json(event)
        except Exception:
            _sockets[user_id].discard(ws)


def notify_users(user_ids, event: dict | None = None) -> None:
    """Thread-safe, best-effort push; never raises."""
    loop = _loop
    if loop is None or loop.is_closed():
        return
    payload = event or {"type": "notifications_changed"}
    for user_id in set(user_ids):
        if user_id in _sockets:
            try:
                asyncio.run_coroutine_threadsafe(_send_all(user_id, payload), loop)
            except RuntimeError:
                pass


def _authenticate(token: str) -> int:
    with SessionLocal() as db:
        return user_from_token(db, token).id


@router.websocket("/ws/notifications")
async def notifications_socket(websocket: WebSocket) -> None:
    global _loop
    await websocket.accept()
    _loop = asyncio.get_running_loop()
    user_id: int | None = None
    try:
        try:
            first = await asyncio.wait_for(websocket.receive_json(), AUTH_TIMEOUT_SECONDS)
        except (asyncio.TimeoutError, ValueError):
            await websocket.close(code=1008)
            return
        if not isinstance(first, dict) or first.get("type") != "auth":
            await websocket.close(code=1008)
            return
        try:
            user_id = await run_in_threadpool(_authenticate, str(first.get("token") or ""))
        except AuthError:
            await websocket.send_json({"type": "error", "message": "Sign in to continue"})
            await websocket.close(code=1008)
            return
        if len(_sockets[user_id]) >= MAX_SOCKETS_PER_USER:
            await websocket.close(code=1008)
            user_id = None
            return
        _sockets[user_id].add(websocket)
        await websocket.send_json({"type": "ready"})
        while True:
            message = await websocket.receive_json()
            if isinstance(message, dict) and message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("notification socket closed unexpectedly", exc_info=True)
    finally:
        if user_id is not None:
            _sockets[user_id].discard(websocket)
            if not _sockets[user_id]:
                _sockets.pop(user_id, None)
