"""Rate limiting with two interchangeable stores.

``memory``    sliding window in process memory. Exact, fastest, but private to one process: with
              several API instances each would keep its own counters, so the real limit would be
              multiplied by the number of instances.
``database``  fixed window kept in the application database (``rate_limit_counters``), shared by
              every instance, atomic (one upsert per check), no extra infrastructure. A fixed window
              can let a burst of up to 2x the limit through across a window boundary; that is the
              price of a shared store without Redis.

Choose with ``RATE_LIMIT_BACKEND``. If the shared store is unavailable the limiter FAILS OPEN to the
in-process one (and logs it) rather than turning a database blip into a site-wide outage.
Keys are internal user ids; the key and bucket are never request content.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.engine import Engine

from app.auth import get_current_user
from app.config import settings
from app.models.rate_limit import RateLimitCounter
from app.models.user import User

logger = logging.getLogger(__name__)


class RateLimiter:
    """Sliding window in process memory."""

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


counters = RateLimitCounter.__table__


class DatabaseRateLimiter:
    """Fixed-window counters shared through the database; one atomic upsert per check."""

    CLEANUP_ODDS = 0.01  # share of checks that also delete expired rows

    def __init__(self, engine: Engine, clock=time.time) -> None:
        self.engine = engine
        self._clock = clock

    def _window(self, window: float) -> tuple[int, float]:
        now = self._clock()
        start = int(now // window)
        return start, (start + 1) * window - now  # window id, seconds left in it

    def check(self, bucket: str, key: str, limit: int, window: float) -> float | None:
        start, remaining = self._window(window)
        dialect = self.engine.dialect.name
        insert = (postgresql if dialect == "postgresql" else sqlite).insert
        stmt = insert(counters).values(
            bucket=bucket, key=key, window_start=start, hits=1, expires_at=int(self._clock() + 2 * window)
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[counters.c.bucket, counters.c.key, counters.c.window_start],
            set_={"hits": counters.c.hits + 1},
        ).returning(counters.c.hits)
        with self.engine.begin() as conn:  # its own short transaction, independent of the request session
            hits = conn.execute(stmt).scalar_one()
            if random.random() < self.CLEANUP_ODDS:
                conn.execute(delete(counters).where(counters.c.expires_at < int(self._clock())))
        return None if hits <= limit else max(1.0, remaining)

    def peek(self, bucket: str, key: str, limit: int, window: float) -> bool:
        start, _ = self._window(window)
        with self.engine.connect() as conn:
            hits = conn.execute(
                select(counters.c.hits).where(
                    counters.c.bucket == bucket, counters.c.key == key, counters.c.window_start == start
                )
            ).scalar()
        return (hits or 0) >= limit

    def reset(self) -> None:
        with self.engine.begin() as conn:
            conn.execute(delete(counters))


class Limiter:
    """What the rest of the app talks to: picks the store, falls back to memory if the store fails."""

    def __init__(self) -> None:
        self.memory = RateLimiter()
        self._database: DatabaseRateLimiter | None = None
        self._last_warning = 0.0

    def _store(self):
        if settings.rate_limit_backend != "database":
            return None
        if self._database is None:
            from app.database.database import engine

            self._database = DatabaseRateLimiter(engine)
        return self._database

    def _fallback(self, exc: Exception) -> None:
        now = time.monotonic()
        if now - self._last_warning > 60:  # one line a minute, not one per request
            self._last_warning = now
            logger.warning("shared rate-limit store unavailable (%s); using the in-process limiter", type(exc).__name__)

    def check(self, bucket: str, key: str, limit: int, window: float) -> float | None:
        store = self._store()
        if store is not None:
            try:
                return store.check(bucket, key, limit, window)
            except Exception as exc:  # noqa: BLE001
                self._fallback(exc)
        return self.memory.check(bucket, key, limit, window)

    def peek(self, bucket: str, key: str, limit: int, window: float) -> bool:
        store = self._store()
        if store is not None:
            try:
                return store.peek(bucket, key, limit, window)
            except Exception as exc:  # noqa: BLE001
                self._fallback(exc)
        return self.memory.peek(bucket, key, limit, window)

    def reset(self) -> None:
        self.memory.reset()
        store = self._store()
        if store is not None:
            try:
                store.reset()
            except Exception:  # noqa: BLE001
                pass


limiter = Limiter()


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
