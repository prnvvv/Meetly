"""Timezone-safe datetime helpers.

Every helper normalises naive input to UTC so callers never hit
``TypeError: can't compare offset-naive and offset-aware datetimes``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from app.database.database import utc_now
from app.models.meeting import MeetingStatus

if TYPE_CHECKING:
    from app.models.meeting import Meeting

def format_relative_time(dt: datetime, *, now: datetime | None = None) -> str:
    """Return a human-readable relative time string for ``dt``.

    Examples:
        - "in 2 minutes"
        - "in 3 hours"
        - "2 days ago"
        - "just now"
    """
    target = ensure_aware(dt)
    now_time = _now(now)

    delta = (target - now_time).total_seconds()

    if delta < 0:
        delta = abs(delta)
        if delta < 60:
            return "just now"
        minutes = int(delta // 60)
        hours = minutes // 60
        days = hours // 24
        if days == 1:
            return "1 day ago"
        return f"{days} days ago"

    if delta < 60:
        seconds = int(delta)
        if seconds == 1:
            return "in 1 second"
        return f"in {seconds} seconds"

    minutes = int(delta // 60)
    hours = minutes // 60
    minutes = minutes % 60

    if hours == 0:
        if minutes == 1:
            return "in 1 minute"
        return f"in {minutes} minutes"

    if hours == 1:
        if minutes == 0:
            return "in 1 hour"
        return f"in 1 hour {minutes} minutes"

    days = hours // 24
    hours = hours % 24

    parts = []
    if days == 1:
        parts.append("1 day")
    elif days > 1:
        parts.append(f"{days} days")

    if hours == 1:
        parts.append("1 hour")
    elif hours > 1:
        parts.append(f"{hours} hours")

    if minutes == 1:
        parts.append("1 minute")
    elif minutes > 1:
        parts.append(f"{minutes} minutes")

    if len(parts) == 1:
        return f"in {parts[0]}"

    return f"in {', '.join(parts[:-1])} and {parts[-1]}"


__all__ = [
    "utc_now",
    "ensure_aware",
    "is_future",
    "is_past",
    "is_upcoming",
    "has_ended",
    "calculate_end_time",
    "minutes_between",
    "format_relative_time",
]


def ensure_aware(value: datetime, *, assume_tz: timezone = timezone.utc) -> datetime:
    """Return a UTC-aware datetime, assuming ``assume_tz`` for naive input."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=assume_tz)
    return value.astimezone(timezone.utc)


def _now(now: datetime | None) -> datetime:
    return utc_now() if now is None else ensure_aware(now)


def is_future(value: datetime, *, now: datetime | None = None) -> bool:
    """True when ``value`` lies strictly after ``now``."""
    return ensure_aware(value) > _now(now)


def is_past(value: datetime, *, now: datetime | None = None) -> bool:
    """True when ``value`` lies strictly before ``now``."""
    return ensure_aware(value) < _now(now)


def is_upcoming(meeting: Meeting, *, now: datetime | None = None) -> bool:
    """True while a scheduled meeting is still waiting for its start time."""
    if meeting.status is not MeetingStatus.SCHEDULED:
        return False
    return ensure_aware(meeting.start_time) > _now(now)


def has_ended(meeting: Meeting, *, now: datetime | None = None) -> bool:
    """True for terminal meetings, or a live meeting past its ``end_time``."""
    if meeting.status in (MeetingStatus.ENDED, MeetingStatus.CANCELLED):
        return True
    if meeting.end_time is None:
        return False
    return ensure_aware(meeting.end_time) <= _now(now)


def calculate_end_time(start_time: datetime, duration_minutes: int) -> datetime:
    """End time for a meeting of ``duration_minutes`` from ``start_time``."""
    return ensure_aware(start_time) + timedelta(minutes=duration_minutes)


def minutes_between(start_time: datetime, end_time: datetime) -> int:
    """Whole minutes from start to end, clamped at zero."""
    delta = ensure_aware(end_time) - ensure_aware(start_time)
    return max(0, int(delta.total_seconds() // 60))
