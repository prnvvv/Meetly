"""HTTP-level hardening: response headers, request size limits, WebSocket origin check.

Pure ASGI middleware (no BaseHTTPMiddleware) so streaming bodies and WebSockets
are untouched except where a rule applies.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from app.config import settings

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]

DEFAULT_BODY_LIMIT = 1 * 1024 * 1024  # JSON APIs never need more than this
AVATAR_BODY_LIMIT = 2 * 1024 * 1024 + 64 * 1024  # image cap + slack for the envelope
AVATAR_PATH = "/api/users/me/avatar"


def body_limit_for(path: str) -> int:
    return AVATAR_BODY_LIMIT if path == AVATAR_PATH else DEFAULT_BODY_LIMIT


class BodySizeLimitMiddleware:
    """Reject oversized request bodies early (413), both by header and while streaming."""

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS", "DELETE"):
            await self.app(scope, receive, send)
            return
        limit = body_limit_for(scope["path"])
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        declared = headers.get(b"content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            await self._reject(send)
            return

        received = 0
        too_big = False

        async def limited_receive() -> dict[str, Any]:
            nonlocal received, too_big
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    too_big = True
                    # Hand the app an empty, finished body; the response below wins.
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        started = False

        async def guarded_send(message: dict[str, Any]) -> None:
            nonlocal started
            if too_big and not started:
                started = True
                await self._reject(send)
                return
            if too_big:
                return
            await send(message)

        await self.app(scope, limited_receive, guarded_send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = json.dumps({"detail": "Request body is too large"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


class SecurityHeadersMiddleware:
    """Conservative headers for an API: no sniffing, no framing, no caching of responses."""

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                extra = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"cross-origin-resource-policy", b"same-site"),
                ]
                if scope["path"].startswith("/api"):
                    extra.append((b"cache-control", b"no-store"))
                if settings.is_production:
                    extra.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
                headers.extend(h for h in extra if h[0] not in present)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


def origin_allowed(origin: str | None, allowed: Iterable[str] | None = None) -> bool:
    """A WebSocket from a browser carries Origin; refuse other sites. No Origin (non-browser) is allowed:
    the token in the first message is what authenticates."""
    if not origin:
        return True
    return origin.rstrip("/") in {o.rstrip("/") for o in (allowed if allowed is not None else settings.cors_origins)}
