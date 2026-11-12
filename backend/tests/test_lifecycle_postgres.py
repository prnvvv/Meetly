"""Empty-room sweeper against REAL persisted rows on PostgreSQL (scratch schema, dropped afterwards).

Opt-in like the RLS tests: set MEETLY_PG_TEST_URL (CI does, with a service container). It proves the
sweeper works on committed rows in a real database, across separate sessions, which is what a backend
restart looks like: nothing survives except the database.
"""

from __future__ import annotations

import os
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

URL = os.getenv("MEETLY_PG_TEST_URL", "")
SSLMODE = os.getenv("MEETLY_PG_TEST_SSLMODE", "require")
pytestmark = pytest.mark.skipif(not URL, reason="set MEETLY_PG_TEST_URL to run PostgreSQL tests")
if URL and "supabase" in URL and os.getenv("DATABASE_TARGET_ENV", "").lower() != "development":
    pytestmark = pytest.mark.skip(reason="refusing to create a scratch schema on a non-development Supabase database")

if URL:
    from app.database.database import Base, normalize_database_url
    from app.models import Meeting, MeetingHistory, MeetingStatus, Participant, User
    from app.services import lifecycle_service
    from app.utils.datetime_utils import utc_now

GRACE = timedelta(minutes=10)


@pytest.fixture()
def pg():
    engine = create_engine(normalize_database_url(URL), connect_args={"sslmode": SSLMODE}, pool_size=3)
    schema = "sweep_t_" + uuid.uuid4().hex[:10]
    scoped = engine.execution_options(schema_translate_map={None: schema})
    with engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    Base.metadata.create_all(scoped)
    try:
        yield scoped
    finally:
        with engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()


def _seed(engine):
    """An abandoned room (a participant row still 'present'), an occupied room, a fresh room."""
    now = utc_now()
    with Session(engine) as s:
        host = User(email=f"h{uuid.uuid4().hex[:6]}@example.com", name="Host")
        s.add(host)
        s.commit()

        def meeting(public_id, started_ago):
            m = Meeting(meeting_id=public_id, host_id=host.id, title="t", start_time=now - started_ago,
                        status=MeetingStatus.ACTIVE, meeting_link=f"http://x/{public_id}")
            s.add(m)
            s.commit()
            return m

        abandoned = meeting("900000001", timedelta(hours=3))
        occupied = meeting("900000002", timedelta(hours=3))
        fresh = meeting("900000003", timedelta(minutes=2))
        ghost = Participant(meeting_id=abandoned.id, user_id=host.id, display_name="ghost", joined_at=now - timedelta(hours=3))
        live = Participant(meeting_id=occupied.id, user_id=host.id, display_name="live", joined_at=now - timedelta(hours=3))
        s.add_all([ghost, live])
        s.commit()
        return {"ghost": ghost.id, "live": live.id}


def _status(engine, public_id):
    with Session(engine) as s:
        return s.query(Meeting).filter_by(meeting_id=public_id).one().status


def test_restart_leaves_ghost_rows_and_the_sweeper_cleans_up_without_touching_live_rooms(pg):
    ids = _seed(pg)
    # Backend "restart": a brand new session, the only live socket is the occupied room's participant.
    with Session(pg) as s:
        assert lifecycle_service.end_empty_meetings(s, grace=GRACE, live_meeting_ids={"900000002"}) == []  # ghost looks occupied
        reconciled = lifecycle_service.reconcile_ghost_participants(s, grace=GRACE, live_participant_ids={ids["live"]})
        assert reconciled == 1
    with Session(pg) as s:  # another session: the change was committed
        ended = lifecycle_service.end_empty_meetings(s, grace=GRACE, live_meeting_ids={"900000002"})
        assert ended == ["900000001"]
    assert _status(pg, "900000001") is MeetingStatus.ENDED
    assert _status(pg, "900000002") is MeetingStatus.ACTIVE      # live socket: untouched
    assert _status(pg, "900000003") is MeetingStatus.ACTIVE      # inside the grace period: untouched
    with Session(pg) as s:
        history = s.query(MeetingHistory).join(Meeting, Meeting.id == MeetingHistory.meeting_id).filter(Meeting.meeting_id == "900000001").all()
        assert all(h.ended_at is not None for h in history)
        ghost = s.get(Participant, ids["ghost"])
        assert ghost.left_at is not None
        live = s.get(Participant, ids["live"])
        assert live.left_at is None


def test_a_second_sweep_after_another_restart_changes_nothing(pg):
    ids = _seed(pg)
    for _ in range(2):
        with Session(pg) as s:
            lifecycle_service.reconcile_ghost_participants(s, grace=GRACE, live_participant_ids={ids["live"]})
            lifecycle_service.end_empty_meetings(s, grace=GRACE, live_meeting_ids={"900000002"})
    assert _status(pg, "900000001") is MeetingStatus.ENDED
    assert _status(pg, "900000002") is MeetingStatus.ACTIVE
