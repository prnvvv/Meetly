"""Participant REST endpoint tests (realtime layer + shared schema contract).

These cover the ``/api/meetings/{meeting_id}/participants`` endpoints, whose
response model must stay aligned with the ``Participant`` model: ``meeting_id``
is the internal ``meetings.id`` and ``joined_at`` is nullable.

Run from the ``backend`` directory::

    pytest tests/test_participants.py -v
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# The URL must be set before app.database is imported.
os.environ["DATABASE_URL"] = (
    f"sqlite:///{os.path.join(tempfile.gettempdir(), 'zoom_p2_participants.db')}"
)

from app.database.database import Base  # noqa: E402
from app.database.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.meeting import MeetingStatus  # noqa: E402
from app.models.user import (  # noqa: E402
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
    DEMO_USER_NAME,
    User,
)
from app.services import meeting_service, participant_service  # noqa: E402

MEETING = "849452761"
OTHER_MEETING = "111222333"


def _add_meeting(db, public_id: str, title: str):
    """Insert a meeting under a fixed public id for deterministic URLs."""
    from app.models.meeting import Meeting

    meeting = Meeting(
        meeting_id=public_id,
        host_id=DEMO_USER_ID,
        title=title,
        start_time=datetime.now(timezone.utc),
        status=MeetingStatus.ACTIVE,
        meeting_link=f"http://localhost:3000/meetings/{public_id}",
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


@pytest.fixture()
def db():
    engine = create_engine(
        f"sqlite:///{os.path.join(tempfile.gettempdir(), 'zoom_p2_participants.db')}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    with TestingSession() as session:
        session.add(User(id=DEMO_USER_ID, name=DEMO_USER_NAME, email=DEMO_USER_EMAIL))
        _add_meeting(session, MEETING, "Participant host")
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


# --------------------------------------------------------------------------
# Schema alignment (regression guard)
# --------------------------------------------------------------------------


def test_participant_out_validates_against_a_model_row(db):
    from app.schemas.participant import ParticipantOut

    meeting = meeting_service.get_meeting(db, MEETING)
    participant = participant_service.create_participant(
        db, meeting_id=meeting.id, display_name="Ann"
    )

    payload = ParticipantOut.model_validate(participant)

    assert payload.id == participant.id
    # Internal primary key, not the public nine-digit id.
    assert payload.meeting_id == meeting.id
    assert payload.display_name == "Ann"
    # New joiners start with mic/camera off until their media_state arrives.
    assert payload.is_video_on is False
    assert payload.is_muted is True


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------


def test_add_participant_returns_201_and_serialises(client, db):
    response = client.post(
        f"/api/meetings/{MEETING}/participants",
        json={"display_name": "Ann", "is_muted": False, "is_video_on": True},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["display_name"] == "Ann"
    assert isinstance(body["meeting_id"], int)
    assert body["left_at"] is None


def test_list_participants_returns_only_that_meeting(client, db):
    meeting = meeting_service.get_meeting(db, MEETING)
    participant_service.create_participant(
        db, meeting_id=meeting.id, display_name="Ann"
    )
    other = _add_meeting(db, OTHER_MEETING, "Other meeting")
    participant_service.create_participant(
        db, meeting_id=other.id, display_name="Bob"
    )

    listed = client.get(f"/api/meetings/{MEETING}/participants")

    assert listed.status_code == 200
    assert [row["display_name"] for row in listed.json()] == ["Ann"]


def test_list_participants_can_filter_to_active(client, db):
    meeting = meeting_service.get_meeting(db, MEETING)
    staying = participant_service.create_participant(
        db, meeting_id=meeting.id, display_name="Staying"
    )
    leaving = participant_service.create_participant(
        db, meeting_id=meeting.id, display_name="Leaving"
    )
    participant_service.mark_participant_left(db, leaving.id)

    active = client.get(f"/api/meetings/{MEETING}/participants?active_only=true")
    everyone = client.get(f"/api/meetings/{MEETING}/participants")

    assert [row["id"] for row in active.json()] == [staying.id]
    assert {row["id"] for row in everyone.json()} == {staying.id, leaving.id}


def test_delete_participant_marks_it_left(client, db):
    meeting = meeting_service.get_meeting(db, MEETING)
    participant = participant_service.create_participant(
        db, meeting_id=meeting.id, display_name="Ann"
    )

    deleted = client.delete(f"/api/participants/{participant.id}")

    assert deleted.status_code == 204
    # A 204 must carry no body (older FastAPI versions refuse to even start
    # when the route is declared in a way that implies one).
    assert deleted.content == b""
    db.refresh(participant)
    assert participant.left_at is not None


def test_delete_unknown_participant_returns_404(client):
    assert client.delete("/api/participants/99999").status_code == 404


def test_add_participant_rejects_blank_display_name(client):
    response = client.post(
        f"/api/meetings/{MEETING}/participants", json={"display_name": ""}
    )

    assert response.status_code == 422


# --------------------------------------------------------------------------
# Service-level behaviour behind those endpoints
# --------------------------------------------------------------------------


def test_create_participant_accepts_public_or_internal_meeting_id(db):
    meeting = meeting_service.get_meeting(db, MEETING)

    from_public = participant_service.create_participant(
        db, meeting_id=MEETING, display_name="Public"
    )
    from_internal = participant_service.create_participant(
        db, meeting_id=meeting.id, display_name="Internal"
    )

    assert from_public.meeting_id == from_internal.meeting_id == meeting.id


def test_create_participant_for_unknown_meeting_raises(db):
    from app.services.exceptions import MeetingNotFoundError

    with pytest.raises(MeetingNotFoundError):
        participant_service.create_participant(
            db, meeting_id="999999999", display_name="Ghost"
        )


def test_mark_participant_left_is_idempotent(db):
    meeting = meeting_service.get_meeting(db, MEETING)
    participant = participant_service.create_participant(
        db, meeting_id=meeting.id, display_name="Ann"
    )

    first = participant_service.mark_participant_left(db, participant.id)
    second = participant_service.mark_participant_left(db, participant.id)

    assert first.left_at == second.left_at
    assert participant_service.mark_participant_left(db, 99999) is None


def test_update_participant_state_sets_media_flags(db):
    meeting = meeting_service.get_meeting(db, MEETING)
    participant = participant_service.create_participant(
        db, meeting_id=meeting.id, display_name="Ann"
    )

    updated = participant_service.update_participant_state(
        db, participant.id, is_muted=True, is_video_on=False, screen_share=True
    )

    assert updated.is_muted is True
    assert updated.is_video_on is False
    assert updated.screen_share is True

# --------------------------------------------------------------------------
# Error mapping and field bounds (regression guards)
# --------------------------------------------------------------------------


def test_unknown_meeting_returns_404_not_500(client):
    """Regression: MeetingNotFoundError used to escape as an unhandled 500."""
    listed = client.get("/api/meetings/999999999/participants")
    added = client.post(
        "/api/meetings/999999999/participants", json={"display_name": "Ann"}
    )

    assert listed.status_code == 404
    assert added.status_code == 404


def test_malformed_meeting_id_returns_404(client):
    assert client.get("/api/meetings/not-a-meeting/participants").status_code == 404


@pytest.mark.parametrize("length", [1, 50, 99, 100])
def test_display_name_within_column_limit_accepted(client, length):
    response = client.post(
        f"/api/meetings/{MEETING}/participants",
        json={"display_name": "n" * length},
    )
    assert response.status_code == 201, (length, response.status_code)


@pytest.mark.parametrize("length", [101, 110, 120])
def test_display_name_beyond_column_limit_rejected(client, length):
    """Regression: the schema allowed 120 while the column is String(100)."""
    response = client.post(
        f"/api/meetings/{MEETING}/participants",
        json={"display_name": "n" * length},
    )
    assert response.status_code == 422, (length, response.status_code)
