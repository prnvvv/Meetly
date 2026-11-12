"""Small in-process sliding-window rate limiter.

Meetly runs as a single instance (see render.yaml), so process memory is enough
for now. ``RateLimiter`` is the seam: swap the store for Redis/Postgres if the
API is ever scaled out. Keys are internal user ids (or client IPs when no user).
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

import logging

from fastapi import Depends, HTTPException, Request, status

from app.auth import get_current_user
from app.models.user import User


logger = logging.getLogger(__name__)


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, bucket: str, key: str, limit: int, window: float) -> float | None:
        """Record a hit; return seconds to wait if over the limit, else None."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[(bucket, key)]
            while hits and now - hits[0] >= window:
                hits.popleft()
            if len(hits) >= limit:
                return max(0.0, window - (now - hits[0]))
            hits.append(now)
            if not hits:
                self._hits.pop((bucket, key), None)
            return None

    def peek(self, bucket: str, key: str, limit: int, window: float) -> bool:
        """True if ``key`` has already used up its allowance (does not record a hit)."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits.get((bucket, key))
            if not hits:
                return False
            while hits and now - hits[0] >= window:
                hits.popleft()
            return len(hits) >= limit

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def rate_limit(bucket: str, limit: int, window_seconds: float):
    """FastAPI dependency: ``Depends(rate_limit("search", 30, 60))`` per user."""

    def dependency(request: Request, user: User = Depends(get_current_user)) -> None:
        wait = limiter.check(bucket, f"u{user.id}", limit, window_seconds)
        if wait is not None:
            logger.warning(
                "rate limit exceeded bucket=%s user_id=%s retry_after=%ss", bucket, user.id, int(wait) + 1
            )
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many requests. Please slow down.",
                headers={"Retry-After": str(int(wait) + 1)},
            )

    return dependency
