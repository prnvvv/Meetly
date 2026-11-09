"""Persisted participant state: creation, media flags and departure.

``meeting_id`` accepts either the internal ``meetings.id`` primary key (used
by the realtime handler) or the public nine-digit meeting id string (used by
the REST router). Live sockets and WebRTC state never reach this module.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.participant import Participant
from app.services.meeting_service import require_meeting


class ParticipantNotFoundError(Exception):
    """Raised when a participant row does not exist."""


def _resolve_meeting_pk(db: Session, meeting_id: int | str) -> int:
    """Accept the internal ``meetings.id`` or the public meeting id string."""
    if isinstance(meeting_id, int):
        return meeting_id
    return require_meeting(db, str(meeting_id)).id


def create_participant(
    db: Session,
    *,
    meeting_id: int | str,
    display_name: str,
    is_host: bool = False,
    user_id: int | None = None,
) -> Participant:
    """Create a participant row.

    ``meeting_id`` accepts the internal ``meetings.id`` primary key (via
    ``app.websocket.handler``) or the public meeting id string (via the REST
    router). ``user_id`` is part of the REST contract but is not persisted
    yet: ``Participant`` has no user column, so it is accepted and ignored
    until that column lands.
    """
    participant = Participant(
        meeting_id=_resolve_meeting_pk(db, meeting_id),
        display_name=display_name,
        is_host=is_host,
        user_id=user_id,
        # New joiners start mic/camera off; the client's first media_state
        # broadcast refines these within milliseconds.
        is_muted=True,
        is_video_on=False,
        screen_share=False,
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    return participant


def has_host_participant(db: Session, meeting_id: int | str) -> bool:
    """True when this meeting already has a row flagged as host.

    Used by the realtime join handler to decide who hosts a room. The app has
    no authentication, so the server cannot map a live socket back to
    ``users.id``; the first participant to join is therefore the host, and the
    flag is persisted so later reconnects keep it. The client never chooses.
    """
    pk = _resolve_meeting_pk(db, meeting_id)
    stmt = (
        select(Participant.id)
        .where(Participant.meeting_id == pk, Participant.is_host.is_(True))
        .limit(1)
    )
    return db.execute(stmt).first() is not None


def find_user_participant(db: Session, meeting_pk: int, user_id: int) -> Participant | None:
    """The participant row for an authenticated user in a meeting, if any."""
    stmt = (
        select(Participant)
        .where(Participant.meeting_id == meeting_pk, Participant.user_id == user_id)
        .order_by(Participant.id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def get_participant(db: Session, participant_id: int) -> Participant | None:
    return db.get(Participant, participant_id)


def require_participant(db: Session, participant_id: int) -> Participant:
    participant = get_participant(db, participant_id)
    if participant is None:
        raise ParticipantNotFoundError(f"Participant {participant_id} not found")
    return participant


def get_meeting_participants(
    db: Session,
    meeting_id: int | str,
    *,
    active_only: bool = False,
) -> list[Participant]:
    stmt = select(Participant).where(
        Participant.meeting_id == _resolve_meeting_pk(db, meeting_id)
    )
    if active_only:
        stmt = stmt.where(Participant.left_at.is_(None))
    stmt = stmt.order_by(Participant.id.asc())
    return list(db.scalars(stmt).all())


def update_participant_state(
    db: Session,
    participant_id: int,
    *,
    is_muted: bool | None = None,
    is_video_on: bool | None = None,
    screen_share: bool | None = None,
    display_name: str | None = None,
) -> Participant:
    participant = require_participant(db, participant_id)
    if is_muted is not None:
        participant.is_muted = is_muted
    if is_video_on is not None:
        participant.is_video_on = is_video_on
    if screen_share is not None:
        participant.screen_share = screen_share
    if display_name is not None:
        participant.display_name = display_name
    db.commit()
    db.refresh(participant)
    return participant


def set_participant_host(db: Session, participant_id: int, is_host: bool) -> Participant:
    """Mirror ``Meeting.host_id`` onto the participant's convenience flag.

    The meeting's ``host_id`` stays authoritative; this only keeps the
    broadcast field in sync with it.
    """
    participant = require_participant(db, participant_id)
    participant.is_host = is_host
    db.commit()
    db.refresh(participant)
    return participant


def mark_participant_left(db: Session, participant_id: int) -> Participant | None:
    """Record a graceful or unexpected departure. Idempotent."""
    participant = get_participant(db, participant_id)
    if participant is None:
        return None
    if participant.left_at is None:
        participant.left_at = datetime.now(timezone.utc)
        participant.screen_share = False
        db.commit()
        db.refresh(participant)
    return participant


def mark_participant_removed(db: Session, participant_id: int) -> Participant | None:
    """Mark a participant as removed by the host."""
    participant = get_participant(db, participant_id)
    if participant is None:
        return None
    participant.left_at = datetime.now(timezone.utc)
    participant.screen_share = False
    db.commit()
    db.refresh(participant)
    return participant