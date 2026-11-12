"""Idempotent development seed data.

Run from the ``backend`` directory::

    python -m app.seed.seed_data

Repeated runs never duplicate rows: the demo user and each sample meeting are
looked up before they are inserted. No WebSocket/WebRTC runtime state is
seeded.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.database import init_db
from app.database.session import SessionLocal
from app.models.meeting import Meeting, MeetingStatus
from app.models.participant import Participant
from app.services import account_email
from app.models.user import DEMO_USER_EMAIL, DEMO_USER_ID, DEMO_USER_NAME, User
from app.services import history_service, participant_service
from app.services.meeting_service import build_meeting_link
from app.utils.datetime_utils import calculate_end_time, utc_now
from app.utils.validation import validate_display_name

# Fixed public ids keep the sample set stable across repeated runs.
SAMPLE_ENDED_MEETING_ID = "100000001"
SAMPLE_LIVE_MEETING_ID = "100000002"
SAMPLE_SCHEDULED_MEETING_ID = "100000003"

SAMPLE_ATTENDEES: tuple[str, ...] = ("Alice Johnson", "Marco Reyes")
SAMPLE_MEETING_DESCRIPTION = "Sample meeting created by the development seed."

__all__ = [
    "seed_demo_user",
    "seed_sample_meetings",
    "run_seed",
    "seed",
]


def seed_demo_user(db: Session) -> tuple[User, bool]:
    """Ensure the demo user exists; returns the row and whether it was created."""
    existing = db.get(User, DEMO_USER_ID)
    if existing is not None:
        return existing, False

    by_email = account_email.find_by_email(db, DEMO_USER_EMAIL)
    if by_email is not None:
        return by_email, False

    user = User(id=DEMO_USER_ID, name=DEMO_USER_NAME, email=DEMO_USER_EMAIL)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, True


def _find_meeting(db: Session, meeting_id: str) -> Meeting | None:
    stmt = select(Meeting).where(Meeting.meeting_id == meeting_id)
    return db.scalars(stmt).first()


def _add_sample_meeting(
    db: Session,
    *,
    host_id: int,
    meeting_id: str,
    title: str,
    status: MeetingStatus,
    start_time,
    duration: int | None,
) -> Meeting | None:
    """Insert one sample meeting, or ``None`` when it already exists."""
    if _find_meeting(db, meeting_id) is not None:
        return None

    meeting = Meeting(
        meeting_id=meeting_id,
        host_id=host_id,
        title=title,
        description=SAMPLE_MEETING_DESCRIPTION,
        start_time=start_time,
        end_time=calculate_end_time(start_time, duration) if duration else None,
        duration=duration,
        status=status,
        meeting_link=build_meeting_link(meeting_id),
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


def _seed_attendees(db: Session, meeting: Meeting) -> int:
    """Add two past attendees so history reports a believable count."""
    existing = db.scalars(
        select(Participant).where(Participant.meeting_id == meeting.id).limit(1)
    ).first()
    if existing is not None:
        return 0

    for index, name in enumerate(SAMPLE_ATTENDEES):
        participant = participant_service.create_participant(
            db,
            meeting_id=meeting.id,
            display_name=validate_display_name(name),
            is_host=index == 0,
        )
        participant.joined_at = meeting.start_time
        participant.left_at = meeting.end_time
    db.commit()
    return len(SAMPLE_ATTENDEES)


def seed_sample_meetings(
    db: Session, *, host_id: int = DEMO_USER_ID
) -> dict[str, int]:
    """Create a small deterministic set: one ended, one live, one scheduled."""
    now = utc_now()
    counts = {"meetings": 0, "attendees": 0}

    ended = _add_sample_meeting(
        db,
        host_id=host_id,
        meeting_id=SAMPLE_ENDED_MEETING_ID,
        title="Weekly sync",
        status=MeetingStatus.ENDED,
        start_time=now - timedelta(days=1),
        duration=45,
    )
    if ended is not None:
        counts["meetings"] += 1
        counts["attendees"] += _seed_attendees(db, ended)
        history_service.record_meeting_end(db, ended, ended_at=ended.end_time)

    live = _add_sample_meeting(
        db,
        host_id=host_id,
        meeting_id=SAMPLE_LIVE_MEETING_ID,
        title="Design review",
        status=MeetingStatus.ACTIVE,
        start_time=now - timedelta(minutes=10),
        duration=None,
    )
    if live is not None:
        counts["meetings"] += 1
        history_service.record_meeting_start(db, live)

    scheduled = _add_sample_meeting(
        db,
        host_id=host_id,
        meeting_id=SAMPLE_SCHEDULED_MEETING_ID,
        title="Sprint planning",
        status=MeetingStatus.SCHEDULED,
        start_time=now + timedelta(days=1),
        duration=30,
    )
    if scheduled is not None:
        counts["meetings"] += 1

    return counts


def run_seed(db: Session) -> dict[str, int]:
    """Insert whatever is missing and report how many rows were created.

    Creates the schema first when it is missing, so this is safe to call
    against a fresh database. Both steps are idempotent.
    """
    init_db()
    user, user_created = seed_demo_user(db)
    counts = seed_sample_meetings(db, host_id=user.id)
    counts["users"] = int(user_created)
    return counts


def seed() -> dict[str, int]:
    """Seed the configured database using the application session factory."""
    init_db()
    with SessionLocal() as db:
        return run_seed(db)


if __name__ == "__main__":
    summary = seed()
    print(
        "Seed complete: "
        f"{summary['users']} user(s), "
        f"{summary['meetings']} meeting(s), "
        f"{summary['attendees']} attendee(s) created."
    )
