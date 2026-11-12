"""Row Level Security tests, run on a REAL PostgreSQL as the real low-privilege role.

Opt-in: set ``MEETLY_PG_TEST_URL`` to a database you may create a scratch schema in
(a Supabase session-pooler URL works). Every test runs inside its own throwaway schema,
which is dropped afterwards; the public schema is never touched.

These tests never use the owner or service-role connection to judge access: each check
runs after ``SET LOCAL ROLE meetly_app`` with the user id set exactly as the API does.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.orm import Session

URL = os.getenv("MEETLY_PG_TEST_URL", "")
SSLMODE = os.getenv("MEETLY_PG_TEST_SSLMODE", "require")  # "disable" for a local CI container
pytestmark = pytest.mark.skipif(not URL, reason="set MEETLY_PG_TEST_URL to run PostgreSQL RLS tests")

if URL and "supabase" in URL and os.getenv("DATABASE_TARGET_ENV", "").lower() != "development":
    # These tests create and drop a scratch schema: never against staging or production.
    pytestmark = pytest.mark.skip(reason="refusing to run RLS tests against a non-development Supabase database")

if URL:  # imports that need the optional driver / configuration
    from app.config import settings
    from app.database import rls
    from app.database.database import Base, normalize_database_url
    from app.models import (
        FriendRequest, Friendship, Meeting, MeetingInvitation, MeetingStatus, Notification,
        Participant, User, UserBlock, UserProfile, WaitingRoomEntry,
    )
    from app.schemas.profile import ProfileUpdate
    from app.services import (
        block_service, friend_service, invitation_service, meeting_service, notification_service,
        people_service, profile_service, waiting_room_service,
    )
    from app.schemas.meeting import MeetingCreate
    from app.utils.datetime_utils import utc_now


@pytest.fixture(scope="module")
def world():
    engine = create_engine(normalize_database_url(URL), connect_args={"sslmode": SSLMODE}, pool_size=4)
    schema = "rls_t_" + uuid.uuid4().hex[:10]
    scoped = engine.execution_options(schema_translate_map={None: schema})
    with engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    Base.metadata.create_all(scoped)
    with engine.begin() as conn:
        for stmt in rls.role_statements() + rls.policy_statements(schema):
            conn.execute(text(stmt))
    previous = settings.database_rls_enforce
    settings.database_rls_enforce = True
    try:
        yield engine, scoped, schema
    finally:
        settings.database_rls_enforce = previous
        with engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()


class Ctx:
    def __init__(self, scoped, schema):
        self.scoped, self.schema = scoped, schema

    def owner(self) -> Session:
        return Session(self.scoped, expire_on_commit=False)

    def as_user(self, user_id: int | None) -> Session:
        s = Session(self.scoped, expire_on_commit=False)
        if user_id is not None:
            s.info["rls_user_id"] = user_id
        return s

    def sql(self, user_id: int | None, statement: str, **params):
        """Run raw SQL as the app role for ``user_id`` (None = role without identity)."""
        s = self.as_user(user_id)
        try:
            if user_id is None:
                s.execute(text(f"SET LOCAL ROLE {rls.ROLE}"))
            result = s.execute(text(statement.replace("{S}", f'"{self.schema}"')), params)
            rows = result.fetchall() if result.returns_rows else result.rowcount
            s.commit()
            return rows
        finally:
            s.close()


@pytest.fixture(scope="module")
def ctx(world):
    _, scoped, schema = world
    return Ctx(scoped, schema)


@pytest.fixture(scope="module")
def data(ctx):
    """a, b are friends; c is private; d blocked a; e is a stranger; meeting M hosted by a."""
    with ctx.owner() as db:
        users = {}
        for key, vis in (("a", "public"), ("b", "friends"), ("c", "private"), ("d", "public"), ("e", "public"), ("f", "public")):
            u = User(name=f"User {key}", email=f"{key}@rls.invalid", clerk_id=f"rls_{key}")
            db.add(u)
            db.flush()
            db.add(UserProfile(user_id=u.id, username=f"user_{key}", display_name=f"User {key}", visibility=vis, bio=f"bio {key}"))
            users[key] = u.id
        db.flush()
        low, high = sorted((users["a"], users["b"]))
        db.add(Friendship(user_low_id=low, user_high_id=high))
        db.add(UserBlock(blocker_id=users["d"], blocked_id=users["a"]))
        db.add(FriendRequest(sender_id=users["e"], receiver_id=users["f"], pair_low=min(users["e"], users["f"]), pair_high=max(users["e"], users["f"])))
        m = Meeting(meeting_id="700000001", host_id=users["a"], title="A meeting", start_time=utc_now(), status=MeetingStatus.ACTIVE, meeting_link="x")
        m2 = Meeting(meeting_id="700000002", host_id=users["c"], title="C meeting", start_time=utc_now(), status=MeetingStatus.ENDED, meeting_link="y")
        db.add_all([m, m2])
        db.flush()
        db.add_all([
            Participant(meeting_id=m.id, user_id=users["a"], display_name="A", is_host=True),
            Participant(meeting_id=m.id, user_id=users["b"], display_name="B"),
            Participant(meeting_id=m2.id, user_id=users["c"], display_name="C", is_host=True),
            MeetingInvitation(meeting_id=m.id, inviter_id=users["a"], invitee_id=users["e"], expires_at=utc_now()),
            WaitingRoomEntry(meeting_id=m.id, user_id=users["e"], display_name="E"),
            WaitingRoomEntry(meeting_id=m2.id, user_id=users["f"], display_name="F"),
            Notification(recipient_id=users["b"], type="x", payload={"actor_id": users["a"]}, dedupe_key="n-ab"),
            Notification(recipient_id=users["e"], type="x", payload={"actor_id": users["f"]}, dedupe_key="n-fe"),
        ])
        db.commit()
        users["m"], users["m2"] = m.id, m2.id
        return users


# ---- the role itself -----------------------------------------------------------------------


def test_role_is_not_privileged(ctx, data):
    row = ctx.sql(data["a"], "SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user")[0]
    assert tuple(row) == (rls.ROLE, False, False)


def test_without_an_identity_nothing_is_visible(ctx, data):
    for table in ("users", "user_profiles", "friend_requests", "friendships", "user_blocks", "notifications",
                  "meeting_invitations", "participants", "waiting_room_entries", "meetings"):
        assert ctx.sql(None, f"SELECT count(*) FROM {{S}}.{table}")[0][0] == 0, table


def test_unused_and_internal_tables_are_off_limits(ctx, data):
    for table in ("activity_events", "invitations"):
        with pytest.raises(ProgrammingError):
            ctx.sql(data["a"], f"SELECT * FROM {{S}}.{table}")


# ---- users and profiles -----------------------------------------------------------------------


def test_users_table_shows_only_your_own_row(ctx, data):
    assert [r[0] for r in ctx.sql(data["a"], "SELECT id FROM {S}.users")] == [data["a"]]
    assert ctx.sql(data["a"], "SELECT count(*) FROM {S}.users WHERE id = :o", o=data["b"])[0][0] == 0
    assert ctx.sql(data["a"], "UPDATE {S}.users SET name = 'hacked' WHERE id = :o", o=data["b"]) == 0
    assert ctx.sql(data["a"], "UPDATE {S}.users SET name = 'User a' WHERE id = :o", o=data["a"]) == 1
    with pytest.raises(DBAPIError):
        ctx.sql(data["a"], "INSERT INTO {S}.users (name, email, created_at) VALUES ('x','x@x.invalid', now())")


def test_profile_visibility_matrix(ctx, data):
    def visible(viewer: str) -> set[str]:
        rows = ctx.sql(data[viewer], "SELECT username FROM {S}.user_profiles")
        return {r[0] for r in rows}

    assert visible("a") == {"user_a", "user_b", "user_e", "user_f"}  # not private c, not d (d blocked a)
    assert visible("b") == {"user_a", "user_b", "user_d", "user_e", "user_f"}  # friends-only b sees everyone public
    assert visible("e") == {"user_a", "user_b", "user_d", "user_e", "user_f"}  # b is friends-only but still listed (limited card)
    assert visible("c") == {"user_a", "user_b", "user_c", "user_d", "user_e", "user_f"}
    # the blocked side can no longer see the blocker, the blocker still sees who they blocked
    assert "user_d" not in visible("a") and "user_a" in visible("d")


def test_cannot_change_or_create_other_peoples_profiles(ctx, data):
    assert ctx.sql(data["e"], "UPDATE {S}.user_profiles SET bio = 'pwned' WHERE user_id = :o", o=data["a"]) == 0
    assert ctx.sql(data["a"], "UPDATE {S}.user_profiles SET bio = 'bio a' WHERE user_id = :o", o=data["a"]) == 1
    with pytest.raises(DBAPIError):
        ctx.sql(data["e"], "INSERT INTO {S}.user_profiles (user_id, username, display_name, created_at, updated_at) "
                           "VALUES (:o, 'forged', 'F', now(), now())", o=data["a"])
    assert ctx.sql(data["e"], "DELETE FROM {S}.user_profiles WHERE user_id = :o", o=data["a"]) == 0


# ---- social tables ---------------------------------------------------------------------------------


def test_friend_requests_only_visible_to_the_two_parties(ctx, data):
    for viewer in ("e", "f"):
        assert ctx.sql(data[viewer], "SELECT count(*) FROM {S}.friend_requests")[0][0] == 1
    for viewer in ("a", "b", "c"):
        assert ctx.sql(data[viewer], "SELECT count(*) FROM {S}.friend_requests")[0][0] == 0
    with pytest.raises(DBAPIError):  # cannot forge a request from someone else
        ctx.sql(data["a"], "INSERT INTO {S}.friend_requests (sender_id, receiver_id, pair_low, pair_high, status, created_at, updated_at) "
                           "VALUES (:s, :r, :l, :h, 'PENDING', now(), now())",
                s=data["c"], r=data["a"], l=min(data["a"], data["c"]), h=max(data["a"], data["c"]))
    assert ctx.sql(data["a"], "UPDATE {S}.friend_requests SET status = 'ACCEPTED'") == 0


def test_friendships_are_private_to_the_pair(ctx, data):
    assert ctx.sql(data["a"], "SELECT count(*) FROM {S}.friendships")[0][0] == 1
    assert ctx.sql(data["e"], "SELECT count(*) FROM {S}.friendships")[0][0] == 0
    assert ctx.sql(data["e"], "DELETE FROM {S}.friendships") == 0
    with pytest.raises(DBAPIError):  # a pair that does not include you
        low, high = sorted((data["c"], data["e"]))
        ctx.sql(data["a"], "INSERT INTO {S}.friendships (user_low_id, user_high_id, created_at) VALUES (:l, :h, now())", l=low, h=high)


def test_blocks_are_writable_only_by_the_blocker(ctx, data):
    assert ctx.sql(data["a"], "SELECT count(*) FROM {S}.user_blocks")[0][0] == 1  # the blocked person can see it exists
    assert ctx.sql(data["a"], "DELETE FROM {S}.user_blocks") == 0  # but cannot lift it
    assert ctx.sql(data["e"], "SELECT count(*) FROM {S}.user_blocks")[0][0] == 0
    with pytest.raises(DBAPIError):
        ctx.sql(data["e"], "INSERT INTO {S}.user_blocks (blocker_id, blocked_id, created_at) VALUES (:b, :t, now())",
                b=data["a"], t=data["e"])


def test_notifications_belong_to_the_recipient_but_the_cause_may_retract(ctx, data):
    assert [r[0] for r in ctx.sql(data["b"], "SELECT dedupe_key FROM {S}.notifications")] == ["n-ab"]
    assert ctx.sql(data["c"], "SELECT count(*) FROM {S}.notifications")[0][0] == 0
    assert ctx.sql(data["c"], "UPDATE {S}.notifications SET read_at = now()") == 0
    assert ctx.sql(data["b"], "UPDATE {S}.notifications SET read_at = now() WHERE dedupe_key = 'n-ab'") == 1
    # f caused n-fe (for e): f can retract it, an unrelated user cannot
    assert ctx.sql(data["c"], "DELETE FROM {S}.notifications WHERE dedupe_key = 'n-fe'") == 0
    assert ctx.sql(data["f"], "SELECT count(*) FROM {S}.notifications WHERE dedupe_key = 'n-fe'")[0][0] == 1
    assert ctx.sql(data["f"], "UPDATE {S}.notifications SET read_at = now() WHERE dedupe_key = 'n-fe'") == 0  # but not mark it read


# ---- meetings -------------------------------------------------------------------------------------------


def test_invitations_waiting_room_and_participants_are_scoped(ctx, data):
    m = data["m"]
    assert ctx.sql(data["e"], "SELECT count(*) FROM {S}.meeting_invitations")[0][0] == 1  # invitee
    assert ctx.sql(data["a"], "SELECT count(*) FROM {S}.meeting_invitations")[0][0] == 1  # host / inviter
    assert ctx.sql(data["c"], "SELECT count(*) FROM {S}.meeting_invitations")[0][0] == 0
    assert ctx.sql(data["c"], "UPDATE {S}.meeting_invitations SET status = 'ACCEPTED'") == 0

    assert ctx.sql(data["a"], "SELECT count(*) FROM {S}.waiting_room_entries WHERE meeting_id = :m", m=m)[0][0] == 1  # host
    assert ctx.sql(data["e"], "SELECT count(*) FROM {S}.waiting_room_entries")[0][0] == 1  # only own entry
    assert ctx.sql(data["b"], "SELECT count(*) FROM {S}.waiting_room_entries")[0][0] == 0
    assert ctx.sql(data["e"], "UPDATE {S}.waiting_room_entries SET state = 'ADMITTED' WHERE meeting_id = :m", m=m) == 1  # DB cannot tell a guest from the app; the API forbids it
    # the other host (c) cannot see or touch this meeting lobby
    assert ctx.sql(data["c"], "SELECT count(*) FROM {S}.waiting_room_entries WHERE meeting_id = :m", m=m)[0][0] == 0

    assert ctx.sql(data["b"], "SELECT count(*) FROM {S}.participants WHERE meeting_id = :m", m=m)[0][0] == 2  # co-participants
    assert ctx.sql(data["e"], "SELECT count(*) FROM {S}.participants WHERE meeting_id = :m", m=m)[0][0] == 0  # outsiders see none
    with pytest.raises(DBAPIError):  # cannot insert a participant row for someone else
        ctx.sql(data["e"], "INSERT INTO {S}.participants (meeting_id, user_id, display_name, is_host, is_muted, is_video_on, screen_share) "
                           "VALUES (:m, :u, 'x', false, true, false, false)", m=m, u=data["c"])


def test_meetings_readable_by_signed_in_users_but_not_rewritable_by_strangers(ctx, data):
    assert ctx.sql(data["e"], "SELECT count(*) FROM {S}.meetings")[0][0] == 2
    with pytest.raises(DBAPIError):  # cannot create a meeting hosted by someone else
        ctx.sql(data["e"], "INSERT INTO {S}.meetings (meeting_id, host_id, title, start_time, status, meeting_link, waiting_room_enabled, admission_mode, created_at) "
                           "VALUES ('700000009', :h, 't', now(), 'active', 'z', false, 'host_approval', now())", h=data["a"])
    # an ended meeting is frozen for non-hosts
    assert ctx.sql(data["e"], "UPDATE {S}.meetings SET title = 'pwned' WHERE id = :m", m=data["m2"]) == 0
    assert ctx.sql(data["c"], "UPDATE {S}.meetings SET title = 'C meeting' WHERE id = :m", m=data["m2"]) == 1
    assert ctx.sql(data["e"], "DELETE FROM {S}.meetings WHERE id = :m", m=data["m"]) == 0  # no DELETE policy at all


def test_meeting_history_only_for_people_in_the_meeting(ctx, data):
    with ctx.owner() as db:
        db.execute(text(f'INSERT INTO "{ctx.schema}".meeting_history (meeting_id, started_at, participants_count) VALUES (:m, now(), 2)'), {"m": data["m"]})
        db.commit()
    assert ctx.sql(data["b"], "SELECT count(*) FROM {S}.meeting_history")[0][0] == 1
    assert ctx.sql(data["e"], "SELECT count(*) FROM {S}.meeting_history")[0][0] == 0


# ---- the real application code under enforcement ------------------------------------------------------------


def test_app_flows_work_under_rls(ctx, data):
    """Profiles, friends, blocking, notifications, invitations, meetings, waiting room."""
    a, b, c, e, f = (data[k] for k in "abcef")

    # profiles
    with ctx.as_user(a) as db:
        me = db.get(User, a)
        profile = profile_service.update_profile(db, me, ProfileUpdate(bio="hello"))
        assert profile_service.build_view(db, a, profile).bio == "hello"
        assert profile_service.get_view(db, a, e).username == "user_e"
        with pytest.raises(profile_service.ProfileNotFoundError):
            profile_service.get_view(db, a, c)  # private
        with pytest.raises(profile_service.ProfileNotFoundError):
            profile_service.get_view(db, a, data["d"])  # d blocked a
        assert profile_service.get_view(db, a, b).limited is False  # friend

    # people search honours visibility and blocks
    with ctx.as_user(e) as db:
        names = {p.username for p in people_service.search(db, e, "user_").items}
        assert names == {"user_a", "user_b", "user_d", "user_f"}

    # friend request lifecycle across two identities
    with ctx.as_user(a) as db_a:
        result, touched = friend_service.send_request(db_a, a, e)
        assert result.status == "PENDING" and touched == {e}
    with ctx.as_user(e) as db_e:
        assert notification_service.list_for(db_e, e).items[0].type in {"friend_request", "x"}
        incoming = friend_service.list_requests(db_e, e, incoming=True)
        assert [r.person.user_id for r in incoming if r.status == "PENDING"][:1] == [a]
        accepted, _ = friend_service.accept(db_e, e, result.request_id)
        assert accepted.friendship_created is True
    with ctx.as_user(a) as db_a:
        assert e in {p.user_id for p in friend_service.list_friends(db_a, a).items}
        assert any(n.type == "friend_request_accepted" for n in notification_service.list_for(db_a, a).items)
        notification_service.mark_all_read(db_a, a)
        assert notification_service.unread_count(db_a, a) == 0
        friend_service.remove_friend(db_a, a, e)

    # reciprocal request + cancel retracts the other person notification
    with ctx.as_user(a) as db_a:
        r1, _ = friend_service.send_request(db_a, a, e)
    with ctx.as_user(e) as db_e:
        assert notification_service.unread_count(db_e, e) >= 1
    with ctx.as_user(a) as db_a:
        friend_service.cancel(db_a, a, r1.request_id)
    with ctx.as_user(e) as db_e:
        assert not [n for n in notification_service.list_for(db_e, e).items if n.entity_id == r1.request_id and n.type == "friend_request"]

    # blocking
    with ctx.as_user(e) as db_e:
        block_service.block(db_e, e, f)
        assert [p.user_id for p in block_service.list_blocked(db_e, e).items] == [f]
        block_service.unblock(db_e, e, f)

    # meeting lifecycle, invitations, waiting room
    with ctx.as_user(a) as db_a:
        meeting = meeting_service.create_meeting(db_a, MeetingCreate(title="Flow", settings={"waitingRoom": True}), host_id=a)
        assert meeting.waiting_room_enabled is True
    # a and b are friends (seeded); a invites b
    with ctx.as_user(a) as db_a:
        res, _ = invitation_service.invite(db_a, a, meeting.meeting_id, [b])
        assert res.invited == 1
    with ctx.as_user(b) as db_b:
        inv = invitation_service.list_received(db_b, b)
        assert inv and inv[0].meeting.meeting_id == meeting.meeting_id
        out, _ = invitation_service.accept(db_b, b, inv[0].id)
        assert out.status == "ACCEPTED"
        # waiting room: b has no participant row yet, so b waits
        m_b = db_b.scalars(select(Meeting).where(Meeting.meeting_id == meeting.meeting_id)).one()
        adm = waiting_room_service.request_entry(db_b, m_b, b, "B")
        assert adm.action == "wait"
    with ctx.as_user(a) as db_a:
        m_a = db_a.scalars(select(Meeting).where(Meeting.meeting_id == meeting.meeting_id)).one()
        waiting = waiting_room_service.list_waiting(db_a, m_a, {b})
        assert [e_.user_id for e_, _ in waiting] == [b]
        entry, changed = waiting_room_service.admit(db_a, m_a, waiting[0][0].id, a)
        assert changed and entry.state == "ADMITTED"
    with ctx.as_user(b) as db_b:
        m_b = db_b.scalars(select(Meeting).where(Meeting.meeting_id == meeting.meeting_id)).one()
        assert waiting_room_service.request_entry(db_b, m_b, b, "B").action == "proceed"
        from app.services import participant_service

        p = participant_service.create_participant(db_b, meeting_id=m_b.id, display_name="B", user_id=b)
        waiting_room_service.mark_joined(db_b, m_b.id, b)
        assert p.user_id == b
    with ctx.as_user(a) as db_a:
        ended = meeting_service.end_meeting(db_a, meeting.meeting_id, host_id=a)
        assert ended.status.value == "ended"


def test_a_user_cannot_read_another_users_data_through_the_app_code(ctx, data):
    a, c, e = data["a"], data["c"], data["e"]
    with ctx.as_user(e) as db:
        # private profile, someone else notifications and someone else requests are simply absent
        assert db.get(UserProfile, c) is None
        assert db.scalars(select(Notification).where(Notification.recipient_id == data["b"])).all() == []
        assert db.get(User, a) is None
        # even a deliberately forged filter cannot reach other rows
        assert db.execute(text(f'SELECT count(*) FROM "{ctx.schema}".friendships')).scalar() == 0
