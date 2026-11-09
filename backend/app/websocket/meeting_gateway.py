"""Narrow adapter over Backend Developer 1's meeting domain.

The realtime layer must never duplicate meeting validation or meeting-ending
database logic. Every call into BD1's ``Meeting`` model and
``meeting_service`` is funnelled through this single module so the integration
surface stays easy to review and change in one place.

BD1 surface this depends on (verified against ``app.models.meeting``):

    class Meeting(Base)
        id: int                    # internal primary key, used by participant FKs
        meeting_id: str            # PUBLIC id, e.g. "839452761" (never a foreign key)
        host_id: int               # authoritative host identity -> users.id
        status: MeetingStatus      # scheduled | active | ended | cancelled

    app.services.meeting_service.end_meeting(db, meeting) -> Meeting | None

The WebSocket endpoint is keyed by the public ``meeting_id`` string, so every
lookup here queries by that column rather than by primary key.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ENDED_STATUSES = {"ended", "cancelled", "canceled", "completed"}
JOINABLE_STATUSES = {"active"}


def get_meeting(db: Session, meeting_id: str) -> Any | None:
    """Resolve a public meeting id (e.g. ``"839452761"``) to a Meeting row."""
    from app.models.meeting import Meeting

    if meeting_id is None:
        return None

    stmt = select(Meeting).where(Meeting.meeting_id == str(meeting_id))
    return db.scalars(stmt).first()


def _status_value(meeting: Any) -> str:
    status = getattr(meeting, "status", None)
    if status is None:
        return ""
    return str(getattr(status, "value", status)).lower()


def is_ended(meeting: Any) -> bool:
    ended_at = getattr(meeting, "ended_at", None)
    if ended_at is not None:
        return True

    is_ended_flag = getattr(meeting, "is_ended", None)
    if is_ended_flag is not None:
        return bool(is_ended_flag)

    status = _status_value(meeting)
    if status:
        return status in ENDED_STATUSES

    is_active = getattr(meeting, "is_active", None)
    if is_active is not None:
        return not bool(is_active)

    return False


def is_joinable(meeting: Any) -> bool:
    """Only an ``active`` meeting may be joined.

    ``scheduled`` meetings have not started; ``ended`` and ``cancelled`` are
    terminal. Falling back to ``not is_ended`` keeps this working if BD1's
    status enum is ever widened without the realtime layer changing.
    """
    status = _status_value(meeting)
    if status:
        return status in JOINABLE_STATUSES
    return not is_ended(meeting)


def meeting_settings(meeting: Any) -> dict[str, bool]:
    """The host's saved settings, or an empty dict when none were saved."""
    raw = getattr(meeting, "settings", None)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return {k: bool(v) for k, v in data.items()} if isinstance(data, dict) else {}


def is_locked(meeting: Any) -> bool:
    """True when the host locked the meeting against new joiners."""
    return bool(meeting_settings(meeting).get("lockMeeting"))


def get_host_id(meeting: Any) -> int | None:
    """Authoritative host identity. Never derived from a client payload."""
    host_id = getattr(meeting, "host_id", None)
    return int(host_id) if host_id is not None else None


def is_host_participant(meeting: Any, participant: Any) -> bool:
    """Decide whether a participant row belongs to the meeting host.

    INTEGRATION GAP: ``Participant`` has no ``user_id`` column and the app has
    no authentication, so a live socket cannot be mapped back to a user. Until
    BD1 adds a user link (or auth lands), this falls back to the participant's
    own ``is_host`` flag, which is only ever set server-side by
    :func:`app.services.participant_service.set_participant_host`.

    Once a ``user_id`` exists on Participant, compare it against
    ``meeting.host_id`` here and drop the fallback.
    """
    host_id = get_host_id(meeting)
    user_id = getattr(participant, "user_id", None)
    if host_id is not None and user_id is not None:
        return int(user_id) == host_id
    return bool(getattr(participant, "is_host", False))


def end_meeting(db: Session, meeting_id: str) -> Any | None:
    """Terminate a meeting through BD1's meeting service."""
    meeting = get_meeting(db, meeting_id)
    if meeting is None:
        return None

    from app.services import meeting_service

    handler = getattr(meeting_service, "end_meeting", None)
    if callable(handler):
        return handler(db, meeting)

    from app.models.meeting import MeetingStatus

    meeting.status = MeetingStatus.ENDED
    db.commit()
    db.refresh(meeting)
    return meeting