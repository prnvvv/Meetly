"""Meeting lifecycle housekeeping: ending rooms nobody is in any more.

A meeting stays ``active`` until the host ends it or its scheduled time runs
out. If everyone simply closes the tab, nothing ends it, so the dashboard keeps
showing a live meeting and history never closes. The sweeper ends such rooms
after a grace period (so a short network drop or a host reload does not end a
meeting people are about to come back to).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.meeting import Meeting, MeetingStatus
from app.models.participant import Participant
from app.services import meeting_service
from app.utils.datetime_utils import ensure_aware, utc_now

logger = logging.getLogger(__name__)


def find_empty_active_meetings(
    db: Session, *, grace: timedelta, now: datetime | None = None
) -> list[Meeting]:
    """Active meetings with nobody inside whose last activity is older than ``grace``.

    "Inside" is the database view (a participant row without ``left_at``); the
    caller still has to exclude meetings that hold a live socket.
    """
    now = ensure_aware(now or utc_now())
    cutoff = now - grace
    empty: list[Meeting] = []
    meetings = db.scalars(select(Meeting).where(Meeting.status == MeetingStatus.ACTIVE)).all()
    for meeting in meetings:
        rows = db.execute(
            select(Participant.joined_at, Participant.left_at).where(
                Participant.meeting_id == meeting.id
            )
        ).all()
        if any(left is None for _, left in rows):
            continue
        stamps = [ensure_aware(meeting.start_time)] if meeting.start_time else []
        for joined, left in rows:
            stamps.extend(ensure_aware(v) for v in (joined, left) if v is not None)
        last_activity = max(stamps) if stamps else None
        if last_activity is None or last_activity <= cutoff:
            empty.append(meeting)
    return empty


def reconcile_ghost_participants(
    db: Session,
    *,
    grace: timedelta,
    live_participant_ids: set[int] | frozenset[int] = frozenset(),
    now: datetime | None = None,
) -> int:
    """Mark participants as left when their row says "present" but nothing holds their socket.

    A normal disconnect already records ``left_at``. A backend crash or restart cannot, so those rows
    stay "present" forever, show up in rosters and keep their meeting from ever counting as empty.
    A row is only reconciled when it is older than ``grace`` (clients reconnect within seconds after a
    restart and get a fresh ``joined_at``) and no live socket belongs to it. ``left_at`` is set to the
    cut-off, the latest moment we can still vouch for, never to a time in the future.
    """
    now = ensure_aware(now or utc_now())
    cutoff = now - grace
    count = 0
    rows = db.execute(
        select(Participant, Meeting.start_time)
        .join(Meeting, Meeting.id == Participant.meeting_id)
        .where(Participant.left_at.is_(None), Meeting.status == MeetingStatus.ACTIVE)
    ).all()
    for participant, start in rows:
        if participant.id in live_participant_ids:
            continue
        seen = participant.joined_at or start
        if seen is None or ensure_aware(seen) > cutoff:
            continue
        participant.left_at = cutoff
        participant.screen_share = False
        count += 1
    if count:
        db.commit()
        logger.info("reconciled %d participant(s) with no live connection", count)
    return count


def end_empty_meetings(
    db: Session,
    *,
    grace: timedelta,
    live_meeting_ids: set[str] | frozenset[str] = frozenset(),
    now: datetime | None = None,
) -> list[str]:
    """End abandoned meetings and return their public ids.

    ``live_meeting_ids`` are rooms that currently hold a socket; they are never ended.
    """
    ended: list[str] = []
    for meeting in find_empty_active_meetings(db, grace=grace, now=now):
        if meeting.meeting_id in live_meeting_ids:
            continue
        try:
            meeting_service.end_meeting(db, meeting)
        except Exception:  # one broken row must not stop the sweep
            db.rollback()
            logger.exception("could not end empty meeting %s", meeting.meeting_id)
            continue
        ended.append(meeting.meeting_id)
        logger.info("ended empty meeting meeting=%s", meeting.meeting_id)
    return ended
