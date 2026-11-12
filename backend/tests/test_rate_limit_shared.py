"""The shared (database) rate limiter: correct across instances, atomic, fail-open, fixed-window."""

from __future__ import annotations

import threading

import pytest
from sqlalchemy import create_engine, text

from app.config import settings
from app.database.database import Base
from app.security import ratelimit
from app.security.ratelimit import DatabaseRateLimiter, Limiter


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture()
def engine(tmp_path):
    e = create_engine(f"sqlite:///{tmp_path / 'rl.db'}", connect_args={"check_same_thread": False, "timeout": 30})
    Base.metadata.create_all(e)
    yield e
    e.dispose()


def test_allows_up_to_the_limit_then_blocks_with_a_retry_time(engine):
    clock = Clock(1_000_005.0)  # 45 s into a 60 s window (windows start at multiples of 60)
    rl = DatabaseRateLimiter(engine, clock)
    assert [rl.check("search", "u1", 3, 60) for _ in range(3)] == [None, None, None]
    wait = rl.check("search", "u1", 3, 60)
    assert wait is not None and 14 <= wait <= 16  # the 15 s left in this window
    assert rl.peek("search", "u1", 3, 60) is True


def test_a_new_window_starts_fresh(engine):
    clock = Clock()
    rl = DatabaseRateLimiter(engine, clock)
    for _ in range(3):
        rl.check("b", "u", 3, 60)
    assert rl.check("b", "u", 3, 60) is not None
    clock.t += 61
    assert rl.check("b", "u", 3, 60) is None and rl.peek("b", "u", 3, 60) is False


def test_buckets_and_users_are_independent(engine):
    rl = DatabaseRateLimiter(engine, Clock())
    for _ in range(2):
        rl.check("a", "u1", 2, 60)
    assert rl.check("a", "u1", 2, 60) is not None
    assert rl.check("a", "u2", 2, 60) is None  # another user
    assert rl.check("b", "u1", 2, 60) is None  # another bucket


def test_two_instances_share_one_allowance(engine):
    """Two API processes (two limiter objects, one database) must not each grant the full limit."""
    a, b = DatabaseRateLimiter(engine, Clock()), DatabaseRateLimiter(engine, Clock())
    results = [a.check("join", "u", 4, 60) for _ in range(2)] + [b.check("join", "u", 4, 60) for _ in range(4)]
    assert results.count(None) == 4 and len([r for r in results if r is not None]) == 2


def test_concurrent_requests_never_exceed_the_limit(engine):
    rl = DatabaseRateLimiter(engine, Clock())
    allowed: list[bool] = []
    barrier = threading.Barrier(8)
    lock = threading.Lock()

    def hit():
        barrier.wait()
        for _ in range(5):
            ok = rl.check("burst", "u", 10, 60) is None
            with lock:
                allowed.append(ok)

    threads = [threading.Thread(target=hit) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(allowed) == 40 and allowed.count(True) == 10  # exactly the limit, no lost updates


def test_expired_rows_are_cleaned_up(engine):
    clock = Clock()
    rl = DatabaseRateLimiter(engine, clock)
    rl.CLEANUP_ODDS = 1.0
    rl.check("old", "u", 5, 60)
    clock.t += 500
    rl.check("new", "u", 5, 60)
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM rate_limit_counters WHERE bucket='old'")).scalar() == 0


def test_the_facade_uses_the_chosen_store(engine, monkeypatch):
    lim = Limiter()
    monkeypatch.setattr(settings, "rate_limit_backend", "database")
    lim._database = DatabaseRateLimiter(engine, Clock())
    for _ in range(2):
        lim.check("x", "u", 2, 60)
    assert lim.check("x", "u", 2, 60) is not None
    with engine.connect() as c:
        assert c.execute(text("SELECT hits FROM rate_limit_counters WHERE bucket='x'")).scalar() >= 3
    assert lim.memory._hits == {}  # the in-process store was not used
    lim.reset()
    assert lim.check("x", "u", 2, 60) is None


def test_the_facade_defaults_to_memory(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_backend", "memory")
    lim = Limiter()
    assert lim._store() is None
    assert [lim.check("m", "u", 2, 60) for _ in range(3)][-1] is not None


def test_a_broken_shared_store_fails_open_to_memory_and_says_so(tmp_path, monkeypatch, caplog):
    broken = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")  # no rate_limit_counters table
    lim = Limiter()
    monkeypatch.setattr(settings, "rate_limit_backend", "database")
    lim._database = DatabaseRateLimiter(broken, Clock())
    import logging

    caplog.set_level(logging.WARNING)
    results = [lim.check("f", "u", 2, 60) for _ in range(3)]
    assert results[:2] == [None, None] and results[2] is not None  # still limited, by the in-process store
    assert any("shared rate-limit store unavailable" in r.getMessage() for r in caplog.records)
    assert lim.peek("f", "u", 2, 60) is True


def test_production_refuses_more_than_one_worker(monkeypatch):
    from app.config.settings import Settings

    base = {
        "APP_ENV": "production", "AUTH_MODE": "clerk", "FRONTEND_URL": "https://meetly.example",
        "CLERK_PUBLISHABLE_KEY": "pk_test_YnJhdmUtYWlyZWRhbGUtOTUxOS5jbGVyay5hY2NvdW50cy5kZXYk",
        "CLERK_AUTHORIZED_PARTIES": "https://meetly.example", "DATABASE_URL": "postgresql://u:p@h:6543/d",
        "DATABASE_EXPECTED_REF": "abcdefghijklmnopqrst", "DATABASE_TARGET_ENV": "production",
    }
    for k, v in base.items():
        monkeypatch.setenv(k, v)
    assert Settings().validate_for_production() == []
    monkeypatch.setenv("WEB_CONCURRENCY", "4")
    assert any("exactly one API process" in p for p in Settings().validate_for_production())
    monkeypatch.delenv("WEB_CONCURRENCY")
    monkeypatch.setenv("RATE_LIMIT_BACKEND", "redis")
    assert any("RATE_LIMIT_BACKEND" in p for p in Settings().validate_for_production())
