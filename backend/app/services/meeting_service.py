"""Meeting lifecycle: create, look up, join validation and end/cancel.

Only the public ``Meeting.meeting_id`` (nine digits) ever leaves this layer;
the internal ``Meeting.id`` primary key stays behind the service boundary.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.meeting import Meeting, MeetingStatus
from app.models.user import User
from app.schemas.meeting import MeetingCreate
from app.services import history_service
from app.services.exceptions import (
    InvalidPasswordError,
    InvalidRequestError,
    MeetingConflictError,
    MeetingNotFoundError,
)
from app.utils.datetime_utils import has_ended, is_upcoming, minutes_between, utc_now
from app.utils.meeting_id import generate_meeting_id
from app.utils.password import hash_password, verify_password
from app.utils.validation import (
    validate_host,
    validate_meeting_id,
    validate_meeting_state,
    validate_title,
)

JOINABLE_STATUSES: frozenset[MeetingStatus] = frozenset({MeetingStatus.ACTIVE})

__all__ = [
    "JOINABLE_STATUSES",
    "build_meeting_link",
    "get_meeting",
    "require_meeting",
    "require_host",
    "create_meeting",
    "validate_meeting",
    "end_meeting",
]


def build_meeting_link(meeting_id: str) -> str:
    """Frontend URL for the public meeting id.

    ``FRONTEND_URL`` may list several allowed origins (comma separated); the
    link itself must use the first, canonical one.
    """
    primary_origin = settings.cors_origins[0] if settings.cors_origins else ""
    return f"{primary_origin.rstrip('/')}/meetings/{meeting_id}"


def get_meeting(db: Session, meeting_id: str) -> Meeting | None:
    """Look a meeting up by its PUBLIC id, or ``None`` so routers can 404."""
    stmt = select(Meeting).where(Meeting.meeting_id == str(meeting_id))
    return db.scalars(stmt).first()


def require_meeting(db: Session, meeting_id: str) -> Meeting:
    """Same as :func:`get_meeting` but raises a 404-level error."""
    meeting = get_meeting(db, meeting_id)
    if meeting is None:
        raise MeetingNotFoundError("Meeting not found")
    return meeting


def require_host(db: Session, host_id: int) -> User:
    """Fetch the host row; the demo user must exist before meetings are created."""
    host = db.get(User, host_id)
    if host is None:
        raise InvalidRequestError("Host user does not exist")
    return host


def create_meeting(
    db: Session, payload: MeetingCreate, *, host_id: int
) -> Meeting:
    """Create an instant meeting that is active immediately."""
    title = validate_title(payload.title)
    host = require_host(db, host_id)
    description = (payload.description or "").strip() or None
    password = (payload.password or "").strip() or None

    meeting_id = generate_meeting_id(db)
    meeting = Meeting(
        meeting_id=meeting_id,
        host_id=host.id,
        title=title,
        description=description,
        start_time=utc_now(),
        end_time=None,
        duration=None,
        status=MeetingStatus.ACTIVE,
        meeting_link=build_meeting_link(meeting_id),
        password_hash=hash_password(password) if password else None,
        settings=json.dumps(payload.settings) if payload.settings else None,
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    history_service.record_meeting_start(db, meeting)
    return meeting


def validate_meeting(db: Session, meeting_id: str, *, password: str | None = None) -> Meeting:
    """Check that a meeting may be joined, activating a due scheduled one.

    :raises MeetingNotFoundError: unknown public id.
    :raises MeetingConflictError: not started yet, cancelled or already ended.
    :raises InvalidPasswordError: password-protected meeting and wrong password.
    """
    validate_meeting_id(meeting_id)
    meeting = require_meeting(db, meeting_id)

    if meeting.status is MeetingStatus.SCHEDULED:
        if is_upcoming(meeting):
            raise MeetingConflictError("Meeting has not started yet")
        meeting.status = MeetingStatus.ACTIVE
        db.commit()
        db.refresh(meeting)
        history_service.record_meeting_start(db, meeting)

    if meeting.status is MeetingStatus.ACTIVE and has_ended(meeting):
        # The window elapsed without anyone ending the meeting. Checked after
        # activation too, so a due-but-overdue meeting never becomes joinable.
        end_meeting(db, meeting)
        raise MeetingConflictError("Meeting has ended")

    validate_meeting_state(meeting, JOINABLE_STATUSES, action="join")

    password = (password or "").strip() or None
    if meeting.password_hash is not None and not verify_password(
        password or "", meeting.password_hash
    ):
        raise InvalidPasswordError("Incorrect meeting password")

    return meeting


def end_meeting(
    db: Session,
    meeting_or_id: Meeting | str,
    *,
    host_id: int | None = None,
) -> Meeting:
    """End a live meeting or cancel one that never started.

    ``meeting_or_id`` accepts a public id string (REST) or an already loaded
    row (realtime gateway). Passing ``host_id`` enforces host ownership;
    leaving it out skips the check for trusted internal callers.

    An already-ended meeting is returned unchanged so repeated ends stay safe.
    """
    if isinstance(meeting_or_id, Meeting):
        meeting = meeting_or_id
    else:
        validate_meeting_id(meeting_or_id)
        meeting = require_meeting(db, meeting_or_id)

    if host_id is not None:
        validate_host(meeting, host_id, action="end")

    if meeting.status is MeetingStatus.ENDED:
        return meeting
    if meeting.status is MeetingStatus.CANCELLED:
        raise MeetingConflictError("Meeting has been cancelled")

    if meeting.status is MeetingStatus.SCHEDULED:
        # Never started: cancelling keeps the lifecycle legal and skips history.
        meeting.status = MeetingStatus.CANCELLED
        db.commit()
        db.refresh(meeting)
        return meeting

    now = utc_now()
    meeting.status = MeetingStatus.ENDED
    meeting.end_time = now
    # The meetings CHECK allows only NULL or > 0, so a same-minute meeting
    # records one minute rather than an invalid zero.
    meeting.duration = max(1, minutes_between(meeting.start_time, now))

    history_service.record_meeting_end(db, meeting, ended_at=now)
    db.refresh(meeting)
    return meeting
