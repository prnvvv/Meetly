"""Schedule service and REST tests (Backend Developer 2).

Run from the ``backend`` directory::

    pytest tests/test_schedules.py -v
"""

from __future__ import annotations

import os
import tempfile
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# The URL must be set before app.database is imported.
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.gettempdir(), 'zoom_p2_schedules.db')}"

from app.database.database import Base  # noqa: E402
from app.database.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.meeting import Meeting, MeetingStatus  # noqa: E402
from app.models.user import (  # noqa: E402
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
    DEMO_USER_NAME,
    User,
)
from app.schemas.schedule import ScheduleMeetingCreate  # noqa: E402
from app.services import meeting_service, schedule_service  # noqa: E402
from app.services.exceptions import InvalidRequestError  # noqa: E402
from app.schemas.meeting import MeetingCreate  # noqa: E402
from app.utils.datetime_utils import utc_now  # noqa: E402
from app.utils.meeting_id import is_valid_meeting_id  # noqa: E402


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    with TestingSession() as session:
        session.add(User(id=DEMO_USER_ID, name=DEMO_USER_NAME, email=DEMO_USER_EMAIL))
        session.commit()
        yield session
    engine.dispose()


@pytest.fixture()
def client(db):
    app = create_app()

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client


def _add_other_user(db) -> int:
    """Second host so host-scoped queries can be asserted."""
    from app.models.user import User

    other = User(id=2, name="Second Host", email="second@example.com")
    db.add(other)
    db.commit()
    return other.id


def _schedule(db, *, title, start_offset, duration=30):
    return schedule_service.create_scheduled_meeting(
        db,
        ScheduleMeetingCreate(
            title=title, start_time=utc_now() + start_offset, duration=duration
        ),
        host_id=DEMO_USER_ID,
    )


# --------------------------------------------------------------------------
# Creation
# --------------------------------------------------------------------------


def test_create_scheduled_meeting_sets_window_and_status(db):
    start = utc_now() + timedelta(days=1)
    created = schedule_service.create_scheduled_meeting(
        db,
        ScheduleMeetingCreate(title="Planning", start_time=start, duration=45),
        host_id=DEMO_USER_ID,
    )

    assert created.status is MeetingStatus.SCHEDULED
    assert created.host_id == DEMO_USER_ID
    assert created.duration == 45
    assert created.start_time == start
    assert created.end_time == start + timedelta(minutes=45)
    assert is_valid_meeting_id(created.meeting_id)


def test_create_scheduled_meeting_rejects_past_start(db):
    with pytest.raises(InvalidRequestError, match="future"):
        _schedule(db, title="Yesterday", start_offset=-timedelta(days=1))


def test_create_scheduled_meeting_rejects_invalid_duration(db):
    # The schema rejects out-of-range durations before the service is reached;
    # validate_duration covers the same range for direct service callers.
    from pydantic import ValidationError

    for duration in (0, -30, 1441):
        with pytest.raises(ValidationError):
            ScheduleMeetingCreate(
                title="Bad duration",
                start_time=utc_now() + timedelta(days=1),
                duration=duration,
            )

    with pytest.raises(InvalidRequestError):
        from app.utils.validation import validate_duration

        validate_duration(0)


def test_create_scheduled_meeting_requires_existing_host(db):
    with pytest.raises(InvalidRequestError):
        schedule_service.create_scheduled_meeting(
            db,
            ScheduleMeetingCreate(
                title="No host",
                start_time=utc_now() + timedelta(days=1),
                duration=30,
            ),
            host_id=DEMO_USER_ID + 99,
        )


# --------------------------------------------------------------------------
# Upcoming
# --------------------------------------------------------------------------


def test_upcoming_meetings_are_sorted_soonest_first(db):
    later = _schedule(db, title="Later", start_offset=timedelta(days=3))
    sooner = _schedule(db, title="Sooner", start_offset=timedelta(hours=2))
    middle = _schedule(db, title="Middle", start_offset=timedelta(days=1))

    upcoming = schedule_service.get_upcoming_meetings(db)

    assert [row.id for row in upcoming] == [sooner.id, middle.id, later.id]


def test_upcoming_excludes_started_and_finished_meetings(db):
    pending = _schedule(db, title="Pending", start_offset=timedelta(days=1))
    meeting_service.create_meeting(db, MeetingCreate(title="Live"), host_id=DEMO_USER_ID)
    finished = meeting_service.create_meeting(
        db, MeetingCreate(title="Done"), host_id=DEMO_USER_ID
    )
    meeting_service.end_meeting(db, finished, host_id=DEMO_USER_ID)

    upcoming = schedule_service.get_upcoming_meetings(db)

    assert [row.id for row in upcoming] == [pending.id]


def test_upcoming_excludes_meetings_whose_start_already_passed(db):
    stale = _schedule(db, title="Stale", start_offset=timedelta(hours=2))
    stale.start_time = utc_now() - timedelta(hours=1)
    db.commit()

    assert schedule_service.get_upcoming_meetings(db) == []


def test_upcoming_respects_host_filter_and_limit(db):
    other_host_id = _add_other_user(db)
    mine = _schedule(db, title="Mine", start_offset=timedelta(hours=1))
    theirs = _schedule(db, title="Theirs", start_offset=timedelta(hours=2))

    other = Meeting(
        meeting_id="900000001",
        host_id=other_host_id,
        title="Other host",
        start_time=utc_now() + timedelta(hours=3),
        end_time=utc_now() + timedelta(hours=4),
        duration=60,
        status=MeetingStatus.SCHEDULED,
        meeting_link="http://localhost:3000/meetings/900000001",
    )
    db.add(other)
    db.commit()

    mine_only = schedule_service.get_upcoming_meetings(db, host_id=DEMO_USER_ID)
    assert [row.id for row in mine_only] == [mine.id, theirs.id]

    other_only = schedule_service.get_upcoming_meetings(db, host_id=other_host_id)
    assert [row.id for row in other_only] == [other.id]

    assert len(schedule_service.get_upcoming_meetings(db, limit=1)) == 1


# --------------------------------------------------------------------------
# Recent
# --------------------------------------------------------------------------


def test_recent_meetings_are_newest_first(db):
    oldest = meeting_service.create_meeting(
        db, MeetingCreate(title="Oldest"), host_id=DEMO_USER_ID
    )
    newest = meeting_service.create_meeting(
        db, MeetingCreate(title="Newest"), host_id=DEMO_USER_ID
    )
    oldest.start_time = utc_now() - timedelta(days=2)
    newest.start_time = utc_now() - timedelta(days=1)
    db.commit()

    recent = schedule_service.get_recent_meetings(db)

    assert [row.id for row in recent] == [newest.id, oldest.id]


def test_recent_excludes_scheduled_and_cancelled(db):
    live = meeting_service.create_meeting(
        db, MeetingCreate(title="Live"), host_id=DEMO_USER_ID
    )
    finished = meeting_service.create_meeting(
        db, MeetingCreate(title="Finished"), host_id=DEMO_USER_ID
    )
    meeting_service.end_meeting(db, finished, host_id=DEMO_USER_ID)
    _schedule(db, title="Upcoming", start_offset=timedelta(days=2))
    cancelled = _schedule(db, title="Cancelled", start_offset=timedelta(days=3))
    meeting_service.end_meeting(db, cancelled, host_id=DEMO_USER_ID)

    recent = schedule_service.get_recent_meetings(db)

    assert [row.id for row in recent] == [finished.id, live.id]
    assert all(row.status is not MeetingStatus.CANCELLED for row in recent)


def test_recent_respects_host_filter_and_limit(db):
    other_host_id = _add_other_user(db)
    mine = meeting_service.create_meeting(
        db, MeetingCreate(title="Mine"), host_id=DEMO_USER_ID
    )
    meeting_service.create_meeting(
        db, MeetingCreate(title="Theirs"), host_id=other_host_id
    )

    assert len(schedule_service.get_recent_meetings(db, limit=1)) == 1
    mine_only = schedule_service.get_recent_meetings(db, host_id=DEMO_USER_ID)
    assert [row.id for row in mine_only] == [mine.id]


# --------------------------------------------------------------------------
# REST integration
# --------------------------------------------------------------------------


def test_create_schedule_endpoint(client):
    start = (utc_now() + timedelta(days=2)).isoformat()
    response = client.post(
        "/api/schedules",
        json={"title": "Retro", "start_time": start, "duration": 30},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "scheduled"
    assert body["duration"] == 30
    assert body["end_time"] > body["start_time"]
    assert is_valid_meeting_id(body["meeting_id"])


def test_create_schedule_endpoint_rejects_bad_input(client):
    past = (utc_now() - timedelta(days=1)).isoformat()
    future = (utc_now() + timedelta(days=1)).isoformat()

    assert client.post(
        "/api/schedules", json={"title": "Past", "start_time": past, "duration": 30}
    ).status_code == 400
    assert client.post(
        "/api/schedules", json={"title": "Zero", "start_time": future, "duration": 0}
    ).status_code == 422
    assert client.post(
        "/api/schedules", json={"title": "", "start_time": future, "duration": 30}
    ).status_code == 422
    assert client.post(
        "/api/schedules", json={"title": "Naive", "start_time": "2030-01-01T10:00:00", "duration": 30}
    ).status_code == 422


def test_upcoming_and_recent_endpoints(client):
    future = (utc_now() + timedelta(days=1)).isoformat()
    client.post(
        "/api/schedules",
        json={"title": "Listed", "start_time": future, "duration": 30},
    )
    created = client.post("/api/meetings", json={"title": "Instant"}).json()
    client.delete(f"/api/meetings/{created['meeting_id']}")

    upcoming = client.get("/api/schedules/upcoming")
    recent = client.get("/api/schedules/recent")

    assert upcoming.status_code == 200
    assert [row["title"] for row in upcoming.json()] == ["Listed"]
    assert recent.status_code == 200
    assert [row["title"] for row in recent.json()] == ["Instant"]


def test_schedule_endpoints_respect_limit_query(client):
    for index in range(3):
        start = (utc_now() + timedelta(days=index + 1)).isoformat()
        client.post(
            "/api/schedules",
            json={"title": f"Meeting {index}", "start_time": start, "duration": 15},
        )

    assert len(client.get("/api/schedules/upcoming", params={"limit": 2}).json()) == 2
    assert client.get("/api/schedules/upcoming", params={"limit": 0}).status_code == 422

# --------------------------------------------------------------------------
# Duration type strictness (regression guard)
# --------------------------------------------------------------------------


@pytest.mark.parametrize("duration", [True, False])
def test_boolean_duration_is_rejected(client, duration):
    """Regression: JSON true/false was coerced into a 1/0 minute meeting."""
    start = (utc_now() + timedelta(days=1)).isoformat()
    response = client.post(
        "/api/schedules",
        json={"title": "bool duration", "start_time": start, "duration": duration},
    )
    assert response.status_code == 422, (duration, response.status_code)


def test_validate_duration_rejects_bool():
    from app.utils.validation import validate_duration

    with pytest.raises(InvalidRequestError):
        validate_duration(True)
    with pytest.raises(InvalidRequestError):
        validate_duration(False)
    assert validate_duration(30) == 30


# --------------------------------------------------------------------------
# Calendar range + edit
# --------------------------------------------------------------------------


def test_range_returns_only_window_and_skips_cancelled(client, db):
    inside = _schedule(db, title="Inside", start_offset=timedelta(days=2))
    _schedule(db, title="Outside", start_offset=timedelta(days=20))
    cancelled = _schedule(db, title="Cancelled", start_offset=timedelta(days=3))
    meeting_service.end_meeting(db, cancelled.meeting_id, host_id=DEMO_USER_ID)

    start = (utc_now() + timedelta(days=1)).isoformat()
    end = (utc_now() + timedelta(days=10)).isoformat()
    response = client.get("/api/schedules/range", params={"start": start, "end": end})

    assert response.status_code == 200
    assert [m["meeting_id"] for m in response.json()] == [inside.meeting_id]


def test_range_rejects_inverted_window(client):
    start = utc_now().isoformat()
    end = (utc_now() - timedelta(days=1)).isoformat()
    response = client.get("/api/schedules/range", params={"start": start, "end": end})
    assert response.status_code == 400


def test_update_schedule_changes_fields_and_end_time(client, db):
    meeting = _schedule(db, title="Old", start_offset=timedelta(days=1))
    new_start = utc_now() + timedelta(days=3)

    response = client.patch(
        f"/api/schedules/{meeting.meeting_id}",
        json={"title": "New", "start_time": new_start.isoformat(), "duration": 60},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "New"
    assert body["duration"] == 60
    db.refresh(meeting)
    assert meeting.end_time == meeting.start_time + timedelta(minutes=60)


def test_update_schedule_rejects_past_start_and_non_scheduled(client, db):
    meeting = _schedule(db, title="Edit me", start_offset=timedelta(days=1))
    past = (utc_now() - timedelta(hours=1)).isoformat()
    assert (
        client.patch(f"/api/schedules/{meeting.meeting_id}", json={"start_time": past}).status_code
        == 400
    )

    meeting_service.end_meeting(db, meeting.meeting_id, host_id=DEMO_USER_ID)
    assert (
        client.patch(f"/api/schedules/{meeting.meeting_id}", json={"title": "x"}).status_code
        == 409
    )
    assert client.patch("/api/schedules/999999999", json={"title": "x"}).status_code == 404
