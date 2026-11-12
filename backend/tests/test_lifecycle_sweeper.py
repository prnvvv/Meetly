"""Empty-room sweeper: abandoned active meetings end, occupied or recent ones do not."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.gettempdir(), 'meetly_lifecycle.db')}"

from app.database.database import Base  # noqa: E402
from app.models.meeting import Meeting, MeetingStatus  # noqa: E402
from app.models.meeting_history import MeetingHistory  # noqa: E402
from app.models.participant import Participant  # noqa: E402
from app.models.user import DEMO_USER_EMAIL, DEMO_USER_ID, DEMO_USER_NAME, User  # noqa: E402
from app.services import lifecycle_service  # noqa: E402

GRACE = timedelta(minutes=10)
NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)


@pytest.fixture()
def db():
    engine = create_engine(
        f"sqlite:///{os.path.join(tempfile.gettempdir(), 'meetly_lifecycle.db')}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    session.add(User(id=DEMO_USER_ID, email=DEMO_USER_EMAIL, name=DEMO_USER_NAME, clerk_id=None))
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)
    engine.dispose()


def _meeting(db, public_id, *, started_ago, status=MeetingStatus.ACTIVE):
    meeting = Meeting(
        meeting_id=public_id,
        host_id=DEMO_USER_ID,
        title="t",
        start_time=NOW - started_ago,
        status=status,
        meeting_link=f"http://x/{public_id}",
    )
    db.add(meeting)
    db.commit()
    return meeting


def _participant(db, meeting, *, joined_ago, left_ago=None):
    db.add(
        Participant(
            user_id=DEMO_USER_ID,
            meeting_id=meeting.id,
            display_name="p",
            joined_at=NOW - joined_ago,
            left_at=None if left_ago is None else NOW - left_ago,
        )
    )
    db.commit()


def _status(db, public_id):
    db.expire_all()
    return db.query(Meeting).filter_by(meeting_id=public_id).one().status


def test_ends_meeting_everyone_left_long_ago(db):
    m = _meeting(db, "100000001", started_ago=timedelta(hours=2))
    _participant(db, m, joined_ago=timedelta(hours=2), left_ago=timedelta(minutes=30))
    assert lifecycle_service.end_empty_meetings(db, grace=GRACE, now=NOW) == ["100000001"]
    assert _status(db, "100000001") is MeetingStatus.ENDED
    assert db.query(MeetingHistory).filter_by(meeting_id=m.id).one().ended_at is not None


def test_keeps_meeting_inside_grace_period(db):
    m = _meeting(db, "100000002", started_ago=timedelta(hours=1))
    _participant(db, m, joined_ago=timedelta(hours=1), left_ago=timedelta(minutes=2))
    assert lifecycle_service.end_empty_meetings(db, grace=GRACE, now=NOW) == []
    assert _status(db, "100000002") is MeetingStatus.ACTIVE


def test_keeps_meeting_with_someone_inside(db):
    m = _meeting(db, "100000003", started_ago=timedelta(hours=3))
    _participant(db, m, joined_ago=timedelta(hours=3))
    assert lifecycle_service.end_empty_meetings(db, grace=GRACE, now=NOW) == []


def test_keeps_meeting_with_a_live_socket(db):
    m = _meeting(db, "100000004", started_ago=timedelta(hours=2))
    _participant(db, m, joined_ago=timedelta(hours=2), left_ago=timedelta(hours=1))
    ended = lifecycle_service.end_empty_meetings(
        db, grace=GRACE, live_meeting_ids={"100000004"}, now=NOW
    )
    assert ended == []
    assert _status(db, "100000004") is MeetingStatus.ACTIVE


def test_never_touches_scheduled_or_already_ended(db):
    _meeting(db, "100000005", started_ago=timedelta(hours=-5), status=MeetingStatus.SCHEDULED)
    _meeting(db, "100000006", started_ago=timedelta(hours=5), status=MeetingStatus.ENDED)
    assert lifecycle_service.end_empty_meetings(db, grace=GRACE, now=NOW) == []


def test_ends_active_meeting_nobody_ever_joined_after_grace(db):
    _meeting(db, "100000007", started_ago=timedelta(hours=1))
    assert lifecycle_service.end_empty_meetings(db, grace=GRACE, now=NOW) == ["100000007"]


def test_second_sweep_is_a_no_op(db):
    m = _meeting(db, "100000008", started_ago=timedelta(hours=2))
    _participant(db, m, joined_ago=timedelta(hours=2), left_ago=timedelta(hours=1))
    assert lifecycle_service.end_empty_meetings(db, grace=GRACE, now=NOW)
    assert lifecycle_service.end_empty_meetings(db, grace=GRACE, now=NOW) == []
