"""Persistence and isolation audit: does each feature actually save, survive a restart, and stay private?

Each test writes through the real API as one account, reads the data back through a brand-new
database connection (as after a restart) and checks that a second account cannot see or change it.
Also covers multi-user concurrency.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

from app.models import (
    FriendRequest, Friendship, Meeting, MeetingHistory, MeetingInvitation, Notification,
    Participant, User, UserProfile, WaitingRoomEntry,
)
from app.security.ratelimit import limiter
from tests.test_auth import bearer
from tests.test_profiles import client, me  # noqa: F401  (fixtures)
from tests.test_social import H, make_friends, notes, send, uid  # noqa: F401
from tests.test_waiting_room import act, connect, host_in, new_meeting, send_join, until, wait_room  # noqa: F401
from tests.test_waiting_room import stack  # noqa: F401  (fixture)


@pytest.fixture(autouse=True)
def _reset():
    limiter.reset()
    yield


def fresh(client) -> Session:
    """A new connection to the same database file: what a restarted server would see."""
    url = client.Session.kw["bind"].url
    client.Session.kw["bind"].dispose()
    return Session(create_engine(url))


def token(sub: str) -> str:
    return H(sub)["Authorization"].split()[1]


def future(days=2) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


# ---- accounts, profiles, preferences ---------------------------------------------------------------------


def test_profile_and_preferences_persist_and_stay_private(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    r = client.patch("/api/users/me/profile", headers=H("u_a"), json={
        "username": "persist_a", "display_name": "Ada P", "bio": "kept", "location": "Paris",
        "designation": "Eng", "organization": "Org", "website": "https://a.example",
        "social_links": {"github": "https://github.com/a"}, "visibility": "friends", "show_meeting_stats": True,
    })
    assert r.status_code == 200
    client.patch("/api/users/me", headers=H("u_a"), json={"name": "Ada Prefs", "preferences": {"camera_id": "cam-1", "microphone_id": "mic-9"}})
    with fresh(client) as db:
        p = db.get(UserProfile, a)
        assert (p.username, p.display_name, p.bio, p.location, p.visibility, p.show_meeting_stats) == ("persist_a", "Ada P", "kept", "Paris", "friends", True)
        assert p.social_links == {"github": "https://github.com/a"}
        u = db.get(User, a)
        assert u.name == "Ada Prefs" and json.loads(u.preferences) == {"camera_id": "cam-1", "microphone_id": "mic-9"}
    again = client.get("/api/users/me", headers=H("u_a")).json()
    assert again["preferences"]["camera_id"] == "cam-1"
    # the other account has its own, untouched settings and sees only the limited card
    assert client.get("/api/users/me", headers=H("u_b")).json()["preferences"]["camera_id"] is None
    view = client.get(f"/api/users/{a}/profile", headers=H("u_b")).json()
    assert view["limited"] is True and view["bio"] is None
    assert client.get(f"/api/users/{b}/profile", headers=H("u_b")).json()["bio"] is None


# ---- meetings -------------------------------------------------------------------------------------------------


def test_instant_meeting_fields_persist_and_the_password_is_only_a_hash(client):
    r = client.post("/api/meetings", headers=H("host"), json={
        "title": "Board", "description": "agenda", "password": "s3cret!!", "settings": {"lockMeeting": True, "allowChat": False}})
    mid = r.json()["meeting_id"]
    with fresh(client) as db:
        m = db.scalars(select(Meeting).where(Meeting.meeting_id == mid)).one()
        assert (m.title, m.description, m.status.value) == ("Board", "agenda", "active")
        assert m.password_hash and m.password_hash != "s3cret!!" and m.password_hash.startswith("$2")
        assert json.loads(m.settings) == {"lockMeeting": True, "allowChat": False}
        assert m.host_id == uid(client, "host") and m.waiting_room_enabled is False
        assert db.scalars(select(MeetingHistory).where(MeetingHistory.meeting_id == m.id)).one().started_at is not None
    assert client.post(f"/api/meetings/{mid}/join", headers=H("guest"), json={"display_name": "G", "password": "wrong"}).status_code == 403
    assert client.post(f"/api/meetings/{mid}/join", headers=H("guest"), json={"display_name": "G", "password": "s3cret!!"}).status_code == 200


def test_scheduled_meetings_persist_edit_and_are_private_to_the_host(client):
    created = [
        client.post("/api/schedules", headers=H("host"), json={
            "title": f"Weekly {i}", "description": "recurring", "start_time": future(2 + 7 * i), "duration": 45,
            "password": "pw-1234", "settings": {"waitingRoom": i == 0}}).json()
        for i in range(3)  # the UI creates recurring meetings as separate rows
    ]
    ids = [c["meeting_id"] for c in created]
    assert len(set(ids)) == 3
    patched = client.patch(f"/api/schedules/{ids[1]}", headers=H("host"), json={"title": "Moved", "duration": 90})
    assert patched.status_code == 200
    with fresh(client) as db:
        rows = {m.meeting_id: m for m in db.scalars(select(Meeting))}
        assert rows[ids[1]].title == "Moved" and rows[ids[1]].duration == 90 and rows[ids[1]].end_time is not None
        assert rows[ids[0]].waiting_room_enabled is True and rows[ids[2]].waiting_room_enabled is False
        assert all(r.password_hash and r.status.value == "scheduled" for r in rows.values())
    mine = client.get("/api/schedules/upcoming", headers=H("host")).json()
    assert [m["meeting_id"] for m in mine] == [ids[0], ids[1], ids[2]]
    assert client.get("/api/schedules/upcoming", headers=H("other")).json() == []
    assert client.patch(f"/api/schedules/{ids[0]}", headers=H("other"), json={"title": "hijack"}).status_code == 403
    assert client.get(f"/api/meetings/{ids[0]}", headers=H("host")).json()["title"] == "Weekly 0"


def test_participants_history_and_roles_over_a_full_meeting(client, stack):
    meeting = new_meeting(client, waiting=None)
    host = connect(stack, client, "host", meeting)
    hid = until(host, "joined")["participant_id"]
    g1 = connect(stack, client, "g1", meeting)
    until(g1, "joined")
    g2 = connect(stack, client, "g2", meeting)
    until(g2, "joined")
    with fresh(client) as db:
        rows = db.scalars(select(Participant).order_by(Participant.id)).all()
        assert [(r.is_host, r.user_id is not None) for r in rows] == [(True, True), (False, True), (False, True)]
        assert len({r.user_id for r in rows}) == 3
    assert len(client.get(f"/api/meetings/{meeting}/participants", headers=H("host")).json()) == 3
    assert client.get(f"/api/meetings/{meeting}/participants", headers=H("stranger")).status_code == 403
    g1.send_json({"type": "leave", "participant_id": 2})
    host.send_json({"type": "end_meeting", "participant_id": hid})
    until(g2, "meeting_ended")
    with fresh(client) as db:
        m = db.scalars(select(Meeting).where(Meeting.meeting_id == meeting)).one()
        history = db.scalars(select(MeetingHistory).where(MeetingHistory.meeting_id == m.id)).one()
        assert m.status.value == "ended" and m.end_time and m.duration >= 1
        assert history.ended_at is not None and history.participants_count == 3
        assert db.scalars(select(Participant).where(Participant.is_host.is_(True))).one().user_id == m.host_id
    recent = client.get("/api/schedules/recent", headers=H("host")).json()
    assert [r["meeting_id"] for r in recent] == [meeting] and client.get("/api/schedules/recent", headers=H("g1")).json() == []


def test_waiting_room_decisions_persist(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "g1"), uid(client, "g2")
    s1, s2 = connect(stack, client, "g1", meeting), connect(stack, client, "g2", meeting)
    until(s1, "waiting"), until(s2, "waiting")
    by_name = {e["display_name"]: e["id"] for e in wait_room(client, meeting)["entries"]}
    act(client, meeting, by_name["g1"], "admit")
    act(client, meeting, by_name["g2"], "reject")
    with fresh(client) as db:
        states = {e.display_name: (e.state, e.decided_by is not None) for e in db.scalars(select(WaitingRoomEntry))}
        assert states == {"g1": ("ADMITTED", True), "g2": ("REJECTED", True)}


# ---- social data ----------------------------------------------------------------------------------------------------


def test_friendships_requests_notifications_and_invitations_persist_and_are_isolated(client):
    a, b = make_friends(client, "u_a", "u_b")
    c = uid(client, "u_c")
    send(client, "u_c", a, 201)
    mid = client.post("/api/meetings", headers=H("u_a"), json={"title": "Invite me"}).json()["meeting_id"]
    assert client.post(f"/api/meetings/{mid}/invitations", headers=H("u_a"), json={"user_ids": [b]}).status_code == 200
    with fresh(client) as db:
        f = db.scalars(select(Friendship)).one()
        assert (f.user_low_id, f.user_high_id) == (min(a, b), max(a, b))
        assert {r.status for r in db.scalars(select(FriendRequest))} == {"ACCEPTED", "PENDING"}
        inv = db.scalars(select(MeetingInvitation)).one()
        assert (inv.inviter_id, inv.invitee_id, inv.status) == (a, b, "PENDING")
        assert {(n.recipient_id, n.type) for n in db.scalars(select(Notification))} == {
            (a, "friend_request_accepted"), (a, "friend_request"), (b, "meeting_invitation")}
    # isolation: c sees none of a/b's data
    assert client.get("/api/friends", headers=H("u_c")).json()["items"] == []
    assert client.get("/api/invitations", headers=H("u_c")).json() == []
    assert all(n["type"] != "meeting_invitation" for n in notes(client, "u_c")["items"])
    # read state persists
    nid = [n for n in notes(client, "u_b")["items"] if n["type"] == "meeting_invitation"][0]["id"]
    client.patch(f"/api/notifications/{nid}/read", headers=H("u_b"))
    with fresh(client) as db:
        assert db.get(Notification, nid).read_at is not None


# ---- concurrency ---------------------------------------------------------------------------------------------------------


def run_threads(fn, n):
    errors: list[BaseException] = []
    barrier = threading.Barrier(n)

    def wrap(i):
        try:
            barrier.wait()
            fn(i)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    ts = [threading.Thread(target=wrap, args=(i,)) for i in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errors, errors[:2]


def test_many_users_creating_meetings_at_once_get_distinct_ids_and_own_them(client):
    users = [f"creator_{i}" for i in range(6)]
    for u in users:
        uid(client, u)
    made: dict[str, list[str]] = {u: [] for u in users}
    lock = threading.Lock()

    def create(i):
        u = users[i]
        for k in range(3):
            r = client.post("/api/meetings", headers=H(u), json={"title": f"{u}-{k}"})
            assert r.status_code == 201, r.text
            with lock:
                made[u].append(r.json()["meeting_id"])

    run_threads(create, 6)
    all_ids = [m for ms in made.values() for m in ms]
    assert len(all_ids) == 18 and len(set(all_ids)) == 18
    with fresh(client) as db:
        for u in users:
            hosted = {m.meeting_id for m in db.scalars(select(Meeting).where(Meeting.host_id == uid(client, u)))}
            assert hosted == set(made[u])


def test_many_participants_joining_one_meeting_at_once_stay_consistent(client, stack):
    meeting = new_meeting(client, waiting=None)
    users = [f"p{i}" for i in range(5)]
    for u in users:
        uid(client, u)
    answers: list[str] = []
    lock = threading.Lock()

    def join(i):
        with client.websocket_connect(f"/ws/meetings/{meeting}") as ws:
            ws.send_json({"type": "join", "meeting_id": meeting, "display_name": users[i], "token": token(users[i])})
            msg = until(ws, "joined")  # others' join broadcasts may arrive first
            with lock:
                answers.append(msg["type"])

    run_threads(join, 5)
    assert answers == ["joined"] * 5
    with fresh(client) as db:
        rows = db.scalars(select(Participant)).all()
        assert len(rows) == 5 and len({r.user_id for r in rows}) == 5 and not any(r.is_host for r in rows)


def test_independent_profile_updates_do_not_interfere(client):
    users = [f"edit_{i}" for i in range(6)]
    ids = {u: uid(client, u) for u in users}

    def edit(i):
        r = client.patch("/api/users/me/profile", headers=H(users[i]), json={"bio": f"bio-{i}", "location": f"city-{i}"})
        assert r.status_code == 200, r.text

    run_threads(edit, 6)
    with fresh(client) as db:
        for i, u in enumerate(users):
            p = db.get(UserProfile, ids[u])
            assert (p.bio, p.location) == (f"bio-{i}", f"city-{i}")


def test_concurrent_edits_to_one_scheduled_meeting_end_in_a_valid_state(client):
    mid = client.post("/api/schedules", headers=H("host"), json={"title": "Orig", "start_time": future(), "duration": 30}).json()["meeting_id"]
    titles = [f"Title {i}" for i in range(6)]
    codes: list[int] = []
    lock = threading.Lock()

    def edit(i):
        r = client.patch(f"/api/schedules/{mid}", headers=H("host"), json={"title": titles[i], "duration": 10 + i})
        with lock:
            codes.append(r.status_code)

    run_threads(edit, 6)
    assert codes == [200] * 6
    with fresh(client) as db:
        m = db.scalars(select(Meeting).where(Meeting.meeting_id == mid)).one()
        assert m.title in titles and m.duration == 10 + titles.index(m.title)  # both fields come from the same request
        assert m.end_time == m.start_time + timedelta(minutes=m.duration)  # title/duration/end stay consistent


def test_the_host_leaving_does_not_end_the_meeting_or_drop_the_others(client, stack):
    meeting = new_meeting(client, waiting=None)
    host = connect(stack, client, "host", meeting)
    hid = until(host, "joined")["participant_id"]
    guest = connect(stack, client, "guest", meeting)
    until(guest, "joined")
    host.send_json({"type": "leave", "participant_id": hid})
    assert until(guest, "participant_left")["participant_id"] == hid
    assert client.get(f"/api/meetings/{meeting}", headers=H("guest")).json()["status"] == "active"
    guest.send_json({"type": "ping"})
    assert until(guest, "pong")
    back = connect(stack, client, "host", meeting)  # the host returns to the same meeting and role
    assert until(back, "joined")["participant_id"] == hid


def test_a_burst_of_forged_and_valid_requests_never_produces_a_server_error(client):
    uid(client, "valid_user")
    forged = bearer("anyone", key=__import__("tests.test_auth", fromlist=["_OTHER_KEY"])._OTHER_KEY)
    statuses: list[int] = []
    lock = threading.Lock()

    def hit(i):
        for k in range(5):
            if i % 2:
                code = client.get("/api/users/me", headers=forged).status_code
            else:
                code = client.get("/api/users/me", headers=H("valid_user")).status_code
            with lock:
                statuses.append((i % 2, code))

    run_threads(hit, 8)
    assert {c for kind, c in statuses if kind == 1} == {401}
    assert {c for kind, c in statuses if kind == 0} == {200}
    assert not any(c >= 500 for _, c in statuses)
