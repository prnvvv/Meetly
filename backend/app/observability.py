"""Request correlation, structured logging with redaction, and safe error responses.

* Every HTTP request gets a request id (a valid inbound ``X-Request-ID`` is kept, otherwise one is
  generated), echoed in the response, stored in a context variable and attached to every log line
  produced while handling it, including error responses, so a user report can be traced.
* ``LOG_FORMAT=json`` (default in production) writes one JSON object per line.
* A redaction filter removes bearer tokens, JWT-shaped strings, key-like secrets and email
  addresses from log messages as a last line of defence. The code never logs them on purpose.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

_VALID_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

_REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}"), "Bearer [redacted]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?"), "[redacted-jwt]"),
    (re.compile(r"\b(?:sk|pk|sb)_(?:test|live|secret|publishable)_[A-Za-z0-9_-]{8,}"), "[redacted-key]"),
    (re.compile(r"\benc:v\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{8,}"), "[redacted-ciphertext]"),
    (re.compile(r"postgres(?:ql)?(?:\+\w+)?://[^\s@/]+:[^\s@]+@"), "postgresql://[redacted]@"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[redacted-email]"),
)


def redact(text: str) -> str:
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


class RedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - a bad format string must never break logging
            return True
        redacted = redact(message)
        if redacted != message:
            record.msg, record.args = redacted, None
        return True


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    _SKIP = {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename", "module", "exc_info",
        "exc_text", "stack_info", "lineno", "funcName", "created", "msecs", "relativeCreated",
        "thread", "threadName", "processName", "process", "message", "taskName", "request_id",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for key, value in record.__dict__.items():
            if key not in self._SKIP and not key.startswith("_"):
                payload[key] = value if isinstance(value, (str, int, float, bool, type(None))) else str(value)
        if record.exc_info:
            # The exception type and where it happened; the message may hold user data, so it is redacted.
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


def configure_logging(app_env: str = "local") -> None:
    """Idempotent: installs one handler on the root logger with the filters above."""
    fmt = os.getenv("LOG_FORMAT", "json" if app_env in ("staging", "production") else "text").lower()
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "_meetly", False):
            root.removeHandler(handler)
    handler = logging.StreamHandler()
    handler._meetly = True  # type: ignore[attr-defined]
    handler.addFilter(RequestIdFilter())
    handler.addFilter(RedactionFilter())
    handler.setFormatter(
        JsonFormatter() if fmt == "json"
        else logging.Formatter("%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level)
    # Quiet the libraries whose per-request chatter duplicates our access log.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


access_log = logging.getLogger("meetly.access")

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


class RequestIdMiddleware:
    """Assign/propagate a request id and write one access-log line per HTTP request."""

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        inbound = headers.get(b"x-request-id", b"").decode("latin-1")
        rid = inbound if _VALID_ID.match(inbound) else uuid.uuid4().hex
        token = request_id_var.set(rid)
        scope.setdefault("state", {})["request_id"] = rid  # survives for handlers that run outside this middleware
        started = time.perf_counter()
        status_holder = {"code": 0}

        async def send_with_id(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                status_holder["code"] = message["status"]
                message.setdefault("headers", [])
                message["headers"] = list(message["headers"]) + [(b"x-request-id", rid.encode())]
            await send(message)

        try:
            await self.app(scope, receive, send_with_id if scope["type"] == "http" else send)
        finally:
            if scope["type"] == "http":
                access_log.info(
                    "%s %s -> %s",
                    scope["method"],
                    scope["path"],  # never the query string: it can carry tokens or search terms
                    status_holder["code"],
                    extra={"duration_ms": round((time.perf_counter() - started) * 1000, 1)},
                )
            request_id_var.reset(token)


def install_exception_handlers(app) -> None:
    """Consistent, non-leaking JSON errors that carry the request id."""
    from fastapi import Request
    from fastapi.responses import JSONResponse
    from sqlalchemy.exc import DBAPIError, OperationalError

    log = logging.getLogger("meetly.errors")

    def rid_of(request: Request) -> str:
        return getattr(request.state, "request_id", None) or request_id_var.get()

    def reply(request: Request, payload: dict, status_code: int, headers: dict | None = None) -> JSONResponse:
        rid = rid_of(request)
        return JSONResponse(
            {**payload, "request_id": rid}, status_code=status_code, headers={"X-Request-ID": rid, **(headers or {})}
        )

    @app.exception_handler(OperationalError)
    async def _db_unavailable(_request: Request, exc: OperationalError):
        log.error("database unavailable (%s)", type(exc.orig).__name__ if exc.orig else "OperationalError")
        return reply(
            _request, {"detail": "The service is temporarily unavailable. Please try again."}, 503, {"Retry-After": "5"}
        )

    @app.exception_handler(DBAPIError)
    async def _db_error(_request: Request, exc: DBAPIError):
        log.error("database error (%s)", type(exc.orig).__name__ if exc.orig else "DBAPIError")
        return reply(_request, {"detail": "Internal server error"}, 500)

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, exc: Exception):
        log.error("unhandled %s", type(exc).__name__, exc_info=exc)
        return reply(_request, {"detail": "Internal server error"}, 500)
