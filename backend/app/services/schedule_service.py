"""Scheduled meetings: creation plus the dashboard listings."""

from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.meeting import Meeting, MeetingStatus
from app.schemas.schedule import ScheduleMeetingCreate, ScheduleMeetingUpdate
from app.services.meeting_service import (
    build_meeting_link,
    require_host,
    require_meeting,
)
from app.services.exceptions import InvalidRequestError
from app.utils.datetime_utils import calculate_end_time, ensure_aware, utc_now
from app.utils.meeting_id import generate_meeting_id
from app.utils.password import hash_password
from app.utils.validation import (
    validate_duration,
    validate_future_datetime,
    validate_host,
    validate_meeting_id,
    validate_meeting_state,
    validate_title,
)

DEFAULT_LIST_LIMIT = 50
RECENT_STATUSES: tuple[MeetingStatus, ...] = (
    MeetingStatus.ACTIVE,
    MeetingStatus.ENDED,
)

__all__ = [
    "DEFAULT_LIST_LIMIT",
    "create_scheduled_meeting",
    "get_upcoming_meetings",
    "get_recent_meetings",
    "get_meetings_in_range",
    "update_scheduled_meeting",
]


def create_scheduled_meeting(
    db: Session, payload: ScheduleMeetingCreate, *, host_id: int
) -> Meeting:
    """Create a meeting that stays ``scheduled`` until its start time."""
    title = validate_title(payload.title)
    duration = validate_duration(payload.duration)
    start_time = validate_future_datetime(payload.start_time)
    host = require_host(db, host_id)
    description = (payload.description or "").strip() or None
    password = (payload.password or "").strip() or None

    meeting_id = generate_meeting_id(db)
    meeting = Meeting(
        meeting_id=meeting_id,
        host_id=host.id,
        title=title,
        description=description,
        start_time=start_time,
        end_time=calculate_end_time(start_time, duration) if duration else None,
        duration=duration,
        status=MeetingStatus.SCHEDULED,
        meeting_link=build_meeting_link(meeting_id),
        password_hash=hash_password(password) if password else None,
        settings=json.dumps(payload.settings) if payload.settings else None,
        waiting_room_enabled=bool((payload.settings or {}).get("waitingRoom")),
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


def get_upcoming_meetings(
    db: Session,
    *,
    host_id: int | None = None,
    limit: int = DEFAULT_LIST_LIMIT,
) -> list[Meeting]:
    """Scheduled meetings that have not started yet, soonest first."""
    stmt = select(Meeting).where(
        Meeting.status == MeetingStatus.SCHEDULED,
        Meeting.start_time > utc_now(),
    )
    if host_id is not None:
        stmt = stmt.where(Meeting.host_id == host_id)
    stmt = stmt.order_by(Meeting.start_time.asc()).limit(limit)
    return list(db.scalars(stmt).all())


def get_recent_meetings(
    db: Session,
    *,
    host_id: int | None = None,
    limit: int = DEFAULT_LIST_LIMIT,
) -> list[Meeting]:
    """Meetings under way or already finished, most recently started first.

    Cancelled meetings and meetings that never started are excluded.
    """
    stmt = select(Meeting).where(Meeting.status.in_(RECENT_STATUSES))
    if host_id is not None:
        stmt = stmt.where(Meeting.host_id == host_id)
    # Secondary sort by id desc keeps the order deterministic when two meetings
    # start in the same microsecond and puts the newer row first.
    stmt = stmt.order_by(Meeting.start_time.desc(), Meeting.id.desc()).limit(limit)
    return list(db.scalars(stmt).all())


RANGE_STATUSES: tuple[MeetingStatus, ...] = (
    MeetingStatus.SCHEDULED,
    MeetingStatus.ACTIVE,
    MeetingStatus.ENDED,
)
MAX_RANGE_LIMIT = 500


def get_meetings_in_range(
    db: Session,
    *,
    start: datetime,
    end: datetime,
    host_id: int | None = None,
    limit: int = MAX_RANGE_LIMIT,
) -> list[Meeting]:
    """Meetings starting in ``[start, end)``, earliest first (calendar view).

    Cancelled meetings are left out, like everywhere else on the dashboard.
    """
    start, end = ensure_aware(start), ensure_aware(end)
    if end <= start:
        raise InvalidRequestError("Range end must be after its start")
    stmt = select(Meeting).where(
        Meeting.status.in_(RANGE_STATUSES),
        Meeting.start_time >= start,
        Meeting.start_time < end,
    )
    if host_id is not None:
        stmt = stmt.where(Meeting.host_id == host_id)
    stmt = stmt.order_by(Meeting.start_time.asc(), Meeting.id.asc()).limit(limit)
    return list(db.scalars(stmt).all())


def update_scheduled_meeting(
    db: Session,
    meeting_id: str,
    payload: ScheduleMeetingUpdate,
    *,
    host_id: int,
) -> Meeting:
    """Edit title, description, start time or duration of a scheduled meeting."""
    validate_meeting_id(meeting_id)
    meeting = require_meeting(db, meeting_id)
    validate_host(meeting, host_id, action="edit")
    validate_meeting_state(meeting, (MeetingStatus.SCHEDULED,), action="edit")

    fields = payload.model_fields_set
    if "title" in fields and payload.title is not None:
        meeting.title = validate_title(payload.title)
    if "description" in fields:
        meeting.description = (payload.description or "").strip() or None
    if "start_time" in fields and payload.start_time is not None:
        meeting.start_time = validate_future_datetime(payload.start_time)
    if "duration" in fields and payload.duration is not None:
        meeting.duration = validate_duration(payload.duration)
    if meeting.duration:
        meeting.end_time = calculate_end_time(meeting.start_time, meeting.duration)

    db.commit()
    db.refresh(meeting)
    return meeting
