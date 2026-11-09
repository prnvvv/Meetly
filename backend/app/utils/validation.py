"""Business-level validation shared by the service layer.

Pydantic schemas already validate router payloads; these helpers protect the
same invariants for calls arriving from WebSocket handlers, seeds or tests.
"""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime

from app.models.meeting import Meeting, MeetingStatus
from app.services.exceptions import (
    InvalidRequestError,
    MeetingConflictError,
    PermissionDeniedError,
)
from app.utils.datetime_utils import ensure_aware, is_future
from app.utils.meeting_id import is_valid_meeting_id

MAX_TITLE_LENGTH = 255
MAX_DISPLAY_NAME_LENGTH = 100
MIN_DURATION_MINUTES = 1
MAX_DURATION_MINUTES = 1440

__all__ = [
    "validate_meeting_id",
    "validate_title",
    "validate_display_name",
    "validate_duration",
    "validate_future_datetime",
    "validate_meeting_state",
    "validate_host",
]


def validate_meeting_id(value: object) -> str:
    """Return a well-formed public meeting id or raise a 400-level error."""
    if not is_valid_meeting_id(value):
        raise InvalidRequestError("Meeting ID must be a 9-digit number")
    return str(value)


def validate_title(value: object) -> str:
    """Return a stripped, non-empty meeting title."""
    if not isinstance(value, str):
        raise InvalidRequestError("Meeting title is required")
    title = value.strip()
    if not 1 <= len(title) <= MAX_TITLE_LENGTH:
        raise InvalidRequestError(
            f"Meeting title must be 1 to {MAX_TITLE_LENGTH} characters"
        )
    return title


def validate_display_name(value: object) -> str:
    """Return a stripped display name that fits ``Participant.display_name``."""
    if not isinstance(value, str):
        raise InvalidRequestError("Display name is required")
    name = value.strip()
    if not 1 <= len(name) <= MAX_DISPLAY_NAME_LENGTH:
        raise InvalidRequestError(
            f"Display name must be 1 to {MAX_DISPLAY_NAME_LENGTH} characters"
        )
    return name


def validate_duration(value: int | None) -> int | None:
    """Return a duration in minutes within the supported range."""
    if value is None:
        return None
    # bool is a subclass of int; reject it so true/false never means 1/0 minutes.
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidRequestError("Duration must be a whole number of minutes")
    if not MIN_DURATION_MINUTES <= value <= MAX_DURATION_MINUTES:
        raise InvalidRequestError(
            f"Duration must be between {MIN_DURATION_MINUTES} "
            f"and {MAX_DURATION_MINUTES} minutes"
        )
    return value


def validate_future_datetime(
    value: datetime, *, now: datetime | None = None
) -> datetime:
    """Return an aware datetime that lies in the future."""
    aware = ensure_aware(value)
    if not is_future(aware, now=now):
        raise InvalidRequestError("Scheduled start time must be in the future")
    return aware


def validate_meeting_state(
    meeting: Meeting,
    allowed: Collection[MeetingStatus],
    *,
    action: str,
) -> None:
    """Raise a 409-level error unless the meeting is in an allowed state."""
    if meeting.status not in allowed:
        raise MeetingConflictError(
            f"Cannot {action} a meeting that is {meeting.status.value}"
        )


def validate_host(meeting: Meeting, host_id: int, *, action: str = "manage") -> None:
    """Raise a 400-level error when ``host_id`` does not own the meeting."""
    if meeting.host_id != host_id:
        raise PermissionDeniedError(f"Only the meeting host can {action} this meeting")
