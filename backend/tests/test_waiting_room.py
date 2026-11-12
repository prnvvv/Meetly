"""Configurable waiting room: admission flow, host controls, state machine, reconnects.

Real Clerk-style tokens for several identities; real WebSocket sessions.
"""

from __future__ import annotations

import json
import threading
from contextlib import ExitStack

import pytest
from sqlalchemy import select, update

from app.models import Meeting, WaitingRoomEntry, WaitingState
from app.security.ratelimit import limiter
from app.services import waiting_room_service as wr
from app.websocket.manager import get_manager
from tests.test_auth import bearer
from tests.test_profiles import client, me  # noqa: F401  (fixtures)
from tests.test_social import H, uid  # noqa: F401


@pytest.fixture(autouse=True)
def _reset(client):
    limiter.reset()
    m = get_manager()
    m._meetings.clear()
    m._lobby.clear()
    m._screen_sharing.clear()
    yield


@pytest.fixture()
def stack():
    with ExitStack() as s:
        yield s


def token(sub: str) -> str:
    return bearer(sub)["Authorization"].split()[1]


def new_meeting(client, sub="host", waiting=True, **extra) -> str:
    body = {"title": "Standup", **extra}
    if waiting is not None:
        body["settings"] = {"waitingRoom": waiting}
    r = client.post("/api/meetings", json=body, headers=H(sub))
    assert r.status_code == 201, r.text
    return r.json()["meeting_id"]


def connect(stack, client, sub, meeting, name=None):
    ws = stack.enter_context(client.websocket_connect(f"/ws/meetings/{meeting}"))
    send_join(ws, sub, meeting, name)
    return ws


def send_join(ws, sub, meeting, name=None):
    ws.send_json(
        {"type": "join", "meeting_id": meeting, "display_name": name or sub, "token": token(sub)}
    )


def until(ws, type_, limit=10):
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == type_:
            return msg
    raise AssertionError(f"no {type_} message")


def collect(ws, *types, limit=12):
    """First message of each wanted type, in whatever order they arrive."""
    found: dict[str, dict] = {}
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] in types:
            found.setdefault(msg["type"], msg)
        if len(found) == len(types):
            return found
    raise AssertionError(f"missing {set(types) - set(found)}")


def quiet(ws):
    """Assert nothing else is queued: the next message answers our ping."""
    ws.send_json({"type": "ping"})
    assert ws.receive_json() == {"type": "pong"}


def drop(ws, host, expect):
    """Close a client socket and wait until the server finished cleaning up (host sees `expect`)."""
    ws.close()
    return until(host, expect)


def host_in(stack, client, meeting, sub="host"):
    ws = connect(stack, client, sub, meeting)
    until(ws, "joined")
    until(ws, "waiting_room_updated")
    return ws


def wait_room(client, meeting, sub="host"):
    r = client.get(f"/api/meetings/{meeting}/waiting-room", headers=H(sub))
    assert r.status_code == 200, r.text
    return r.json()


def act(client, meeting, entry, action, sub="host"):
    return client.post(f"/api/meetings/{meeting}/waiting-room/{entry}/{action}", headers=H(sub))


def entry_state(client, meeting, sub) -> str | None:
    user = uid(client, sub)
    with client.Session() as db:
        m = db.scalars(select(Meeting).where(Meeting.meeting_id == meeting)).one()
        return db.scalars(
            select(WaitingRoomEntry.state).where(
                WaitingRoomEntry.meeting_id == m.id, WaitingRoomEntry.user_id == user
            )
        ).first()


# ---- configuration and backward compatibility ---------------------------------------


def test_waiting_room_is_off_by_default_and_guests_join_directly(client, stack):
    meeting = new_meeting(client, waiting=None)
    body = client.get(f"/api/meetings/{meeting}", headers=H("host")).json()
    assert body["waiting_room_enabled"] is False and body["admission_mode"] == "host_approval"
    uid(client, "guest")
    ws = connect(stack, client, "guest", meeting)
    assert until(ws, "joined")["type"] == "joined"


def test_host_can_enable_at_creation(client):
    meeting = new_meeting(client, waiting=True)
    body = client.get(f"/api/meetings/{meeting}", headers=H("host")).json()
    assert body["waiting_room_enabled"] is True and body["settings"]["waitingRoom"] is True


def test_legacy_unenforced_setting_does_not_change_existing_meetings(client, stack):
    """An old meeting whose JSON says waitingRoom=true was never enforced and still is not."""
    meeting = new_meeting(client, waiting=None)
    with client.Session() as db:
        db.execute(update(Meeting).values(settings=json.dumps({"waitingRoom": True, "lockMeeting": False})))
        db.commit()
    body = client.get(f"/api/meetings/{meeting}", headers=H("host")).json()
    assert body["waiting_room_enabled"] is False
    assert body["settings"]["waitingRoom"] is False  # the API reports what is actually enforced
    uid(client, "guest")
    assert until(connect(stack, client, "guest", meeting), "joined")["type"] == "joined"


def test_scheduled_meeting_honours_the_setting(client):
    from datetime import datetime, timedelta, timezone

    when = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = client.post(
        "/api/schedules",
        json={"title": "Later", "start_time": when, "duration": 30, "settings": {"waitingRoom": True}},
        headers=H("host"),
    )
    assert r.status_code == 201 and r.json()["waiting_room_enabled"] is True


# ---- the participant experience ---------------------------------------------------------


def test_guest_waits_host_sees_request_and_admits(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    guest_id = uid(client, "guest")
    guest = connect(stack, client, "guest", meeting, "Gina Guest")

    waiting = until(guest, "waiting")
    assert waiting["meeting"]["title"] == "Standup" and waiting["meeting"]["host_name"]
    update_ = until(host, "waiting_room_updated")
    assert update_["enabled"] is True and len(update_["entries"]) == 1
    entry = update_["entries"][0]
    assert entry["display_name"] == "Gina Guest" and entry["username"]
    assert set(entry) == {"id", "display_name", "username", "requested_at"}  # no email / ids

    # not part of the room yet: no participant row, no room traffic
    with client.Session() as db:
        from app.models import Participant

        assert db.scalars(select(Participant).where(Participant.user_id == guest_id)).first() is None
    quiet(guest)

    r = act(client, meeting, entry["id"], "admit")
    assert r.status_code == 200 and r.json() == {"id": entry["id"], "state": "ADMITTED", "changed": True}
    assert until(guest, "admitted")["type"] == "admitted"

    send_join(guest, "guest", meeting, "Gina Guest")
    joined = until(guest, "joined")
    assert joined["type"] == "joined"
    seen = collect(host, "participant_joined", "waiting_room_updated")
    assert seen["participant_joined"]["participant"]["display_name"] == "Gina Guest"
    assert seen["waiting_room_updated"]["entries"] == []
    assert entry_state(client, meeting, "guest") == "JOINED"


def test_admitting_twice_is_a_noop(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    eid = wait_room(client, meeting)["entries"][0]["id"]
    assert act(client, meeting, eid, "admit").json()["changed"] is True
    assert act(client, meeting, eid, "admit").json() == {"id": eid, "state": "ADMITTED", "changed": False}
    assert until(guest, "admitted")
    quiet(guest)  # only one admitted event


def test_reject_notifies_and_blocks_rejoin(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    eid = wait_room(client, meeting)["entries"][0]["id"]
    assert act(client, meeting, eid, "reject").json()["state"] == "REJECTED"
    assert until(guest, "rejected")["type"] == "rejected"
    assert wait_room(client, meeting)["entries"] == []
    again = connect(stack, client, "guest", meeting)
    assert until(again, "error")["code"] == "NOT_ADMITTED"
    assert entry_state(client, meeting, "guest") == "REJECTED"


def test_admit_all(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    sockets = []
    for name in ("g1", "g2", "g3"):
        uid(client, name)
        ws = connect(stack, client, name, meeting)
        until(ws, "waiting")
        sockets.append(ws)
    assert len(wait_room(client, meeting)["entries"]) == 3
    assert client.post(f"/api/meetings/{meeting}/waiting-room/admit-all", headers=H("host")).json() == {"admitted": 3}
    for ws in sockets:
        assert until(ws, "admitted")
    assert client.post(f"/api/meetings/{meeting}/waiting-room/admit-all", headers=H("host")).json() == {"admitted": 0}
    assert wait_room(client, meeting)["entries"] == []


def test_host_never_waits(client, stack):
    meeting = new_meeting(client)
    ws = connect(stack, client, "host", meeting)
    assert until(ws, "joined")["type"] == "joined"
    assert entry_state(client, meeting, "host") is None


def test_waiting_guest_cannot_use_room_messages(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    guest.send_json({"type": "offer", "sender_id": 1, "target_id": 2, "payload": {"sdp": "x"}})
    assert until(guest, "error")["code"] == "NOT_A_PARTICIPANT"
    guest.send_json({"type": "end_meeting", "participant_id": 1})
    assert until(guest, "error")["code"] == "NOT_A_PARTICIPANT"
    guest.send_json({"type": "meeting_state", "participant_id": 1})
    assert until(guest, "error")["code"] == "NOT_A_PARTICIPANT"


def test_lobby_is_isolated_from_room_broadcasts(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    uid(client, "member")
    member = connect(stack, client, "member", meeting)
    until(member, "waiting")
    eid = wait_room(client, meeting)["entries"][0]["id"]
    act(client, meeting, eid, "admit")
    until(member, "admitted")
    send_join(member, "member", meeting)
    pid = until(member, "joined")["participant_id"]
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    member.send_json({"type": "reaction", "participant_id": pid, "emoji": "👍"})
    until(host, "reaction")
    quiet(guest)  # the waiting guest saw no reaction, join or leave events


# ---- host controls and authorization -------------------------------------------------------


def test_only_the_host_can_manage(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    eid = wait_room(client, meeting)["entries"][0]["id"]
    for who in ("guest", "stranger"):
        assert act(client, meeting, eid, "admit", who).status_code == 403
        assert act(client, meeting, eid, "reject", who).status_code == 403
        assert client.get(f"/api/meetings/{meeting}/waiting-room", headers=H(who)).status_code == 403
        assert client.post(f"/api/meetings/{meeting}/waiting-room/admit-all", headers=H(who)).status_code == 403
        assert client.patch(f"/api/meetings/{meeting}/waiting-room", json={"enabled": False}, headers=H(who)).status_code == 403
    assert entry_state(client, meeting, "guest") == "WAITING"
    quiet(guest)
    for call in (
        lambda: client.get(f"/api/meetings/{meeting}/waiting-room"),
        lambda: client.post(f"/api/meetings/{meeting}/waiting-room/{eid}/admit"),
        lambda: client.post(f"/api/meetings/{meeting}/waiting-room/admit-all"),
    ):
        assert call().status_code == 401


def test_unknown_meeting_and_entry(client, stack):
    meeting = new_meeting(client)
    other = new_meeting(client, "host2")
    assert client.get("/api/meetings/987654321/waiting-room", headers=H("host")).status_code == 404
    assert act(client, meeting, 99999, "admit").status_code == 404
    # an entry that belongs to another meeting is not addressable through this one
    host_in(stack, client, other, "host2")
    uid(client, "guest")
    guest = connect(stack, client, "guest", other)
    until(guest, "waiting")
    foreign = wait_room(client, other, "host2")["entries"][0]["id"]
    assert act(client, meeting, foreign, "admit").status_code == 404
    assert entry_state(client, other, "guest") == "WAITING"


def test_invalid_state_transitions(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "g1"), uid(client, "g2")
    g1, g2 = connect(stack, client, "g1", meeting), connect(stack, client, "g2", meeting)
    until(g1, "waiting"), until(g2, "waiting")
    by_name = {e["display_name"]: e["id"] for e in wait_room(client, meeting)["entries"]}
    e1, e2 = by_name["g1"], by_name["g2"]
    act(client, meeting, e1, "reject")
    act(client, meeting, e2, "admit")
    assert act(client, meeting, e1, "admit").status_code == 409  # REJECTED -> ADMITTED
    assert act(client, meeting, e2, "reject").status_code == 409  # ADMITTED -> REJECTED
    assert entry_state(client, meeting, "g1") == "REJECTED" and entry_state(client, meeting, "g2") == "ADMITTED"


def test_state_machine_table():
    S = WaitingState
    allowed = {(a, b) for a, bs in wr.TRANSITIONS.items() for b in bs}
    assert allowed == {
        (S.WAITING, S.ADMITTED), (S.WAITING, S.REJECTED), (S.WAITING, S.LEFT),
        (S.ADMITTED, S.JOINED), (S.ADMITTED, S.LEFT),
        (S.JOINED, S.LEFT), (S.JOINED, S.REMOVED),
        (S.LEFT, S.WAITING),
    }
    for terminal in (S.REJECTED, S.REMOVED):
        assert wr.TRANSITIONS[terminal] == frozenset()
    with pytest.raises(wr.InvalidTransition):
        wr._move(None, 1, S.REJECTED, S.ADMITTED)  # rejected before touching the database


def test_concurrent_admission_changes_state_once(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    eid = wait_room(client, meeting)["entries"][0]["id"]
    barrier = threading.Barrier(5)
    results: list[tuple[int, bool | None]] = []

    def go():
        barrier.wait()
        r = act(client, meeting, eid, "admit")
        results.append((r.status_code, r.json().get("changed") if r.status_code == 200 else None))

    ts = [threading.Thread(target=go) for _ in range(5)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert all(code == 200 for code, _ in results), results
    assert sum(1 for _, changed in results if changed) == 1
    assert until(guest, "admitted")
    quiet(guest)


# ---- leaving, reconnecting, restarting ---------------------------------------------------------


def test_waiting_guest_leaving_frees_the_slot_and_can_ask_again(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    until(host, "waiting_room_updated")
    guest.send_json({"type": "leave", "participant_id": 1})
    assert until(host, "waiting_room_updated")["entries"] == []
    assert entry_state(client, meeting, "guest") == "LEFT"
    again = connect(stack, client, "guest", meeting)
    assert until(again, "waiting")["type"] == "waiting"
    assert entry_state(client, meeting, "guest") == "WAITING"


def test_dropped_waiting_connection_is_cleaned_up_and_reconnect_waits_again(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    uid(client, "guest")
    ws = connect(stack, client, "guest", meeting)
    until(ws, "waiting")
    until(host, "waiting_room_updated")
    assert drop(ws, host, "waiting_room_updated")["entries"] == []
    assert entry_state(client, meeting, "guest") == "LEFT"
    again = connect(stack, client, "guest", meeting)
    until(again, "waiting")
    assert entry_state(client, meeting, "guest") == "WAITING"


def test_admission_survives_a_dropped_connection_and_backend_restart(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    uid(client, "guest")
    ws = connect(stack, client, "guest", meeting)
    until(ws, "waiting")
    eid = wait_room(client, meeting)["entries"][0]["id"]
    act(client, meeting, eid, "admit")
    until(ws, "admitted")
    # connection dies before the client re-sends join
    drop(ws, host, "waiting_room_updated")
    assert entry_state(client, meeting, "guest") == "ADMITTED"

    m = get_manager()  # simulate a backend restart: all in-memory state is gone
    m._meetings.clear()
    m._lobby.clear()
    back = connect(stack, client, "guest", meeting)
    assert until(back, "joined")["type"] == "joined"  # no second approval needed
    assert entry_state(client, meeting, "guest") == "JOINED"


def test_waiting_state_is_rebuilt_after_restart(client, stack):
    meeting = new_meeting(client)
    uid(client, "guest")
    with client.Session() as db:
        m = db.scalars(select(Meeting).where(Meeting.meeting_id == meeting)).one()
        db.add(WaitingRoomEntry(meeting_id=m.id, user_id=uid(client, "guest"), display_name="G", state="WAITING"))
        db.commit()
    host = host_in(stack, client, meeting)  # host connects after the "restart"
    quiet(host)
    assert [e["display_name"] for e in wait_room(client, meeting)["entries"]] == ["G"]
    guest = connect(stack, client, "guest", meeting, "G")  # client reconnects: still one entry
    until(guest, "waiting")
    assert len(wait_room(client, meeting)["entries"]) == 1


def test_stale_waiting_entries_are_swept(client):
    from datetime import timedelta

    from app.database.database import utc_now

    meeting = new_meeting(client)
    with client.Session() as db:
        m = db.scalars(select(Meeting).where(Meeting.meeting_id == meeting)).one()
        db.add(WaitingRoomEntry(meeting_id=m.id, user_id=uid(client, "ghost"), display_name="Ghost",
                                state="WAITING", updated_at=utc_now() - timedelta(minutes=10)))
        db.commit()
    assert wait_room(client, meeting)["entries"] == []
    assert entry_state(client, meeting, "ghost") == "LEFT"


def test_joined_guest_reconnects_without_waiting_again(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    uid(client, "guest")
    ws = connect(stack, client, "guest", meeting)
    until(ws, "waiting")
    act(client, meeting, wait_room(client, meeting)["entries"][0]["id"], "admit")
    until(ws, "admitted")
    send_join(ws, "guest", meeting)
    until(ws, "joined")
    # network drop (no leave message) and reconnect
    drop(ws, host, "participant_left")
    again = connect(stack, client, "guest", meeting)
    assert until(again, "joined")["type"] == "joined"


def test_explicit_leave_requires_asking_again(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    act(client, meeting, wait_room(client, meeting)["entries"][0]["id"], "admit")
    until(guest, "admitted")
    send_join(guest, "guest", meeting)
    pid = until(guest, "joined")["participant_id"]
    guest.send_json({"type": "leave", "participant_id": pid})
    assert entry_state(client, meeting, "guest") == "LEFT"
    again = connect(stack, client, "guest", meeting)
    assert until(again, "waiting")["type"] == "waiting"


def test_removed_participant_cannot_come_back(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    host_pid = None
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    act(client, meeting, wait_room(client, meeting)["entries"][0]["id"], "admit")
    until(guest, "admitted")
    send_join(guest, "guest", meeting)
    gid = until(guest, "joined")["participant_id"]
    with client.Session() as db:
        from app.models import Participant

        host_pid = db.scalars(select(Participant.id).where(Participant.is_host.is_(True))).first()
    host.send_json({"type": "remove_participant", "participant_id": host_pid, "target_id": gid})
    assert until(guest, "host_action")["action"] == "removed"
    assert entry_state(client, meeting, "guest") == "REMOVED"
    again = connect(stack, client, "guest", meeting)
    assert until(again, "error")["code"] == "NOT_ADMITTED"


# ---- live configuration --------------------------------------------------------------------------


def test_disabling_admits_everyone_waiting(client, stack):
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    uid(client, "g1")
    g1 = connect(stack, client, "g1", meeting)
    until(g1, "waiting")
    r = client.patch(f"/api/meetings/{meeting}/waiting-room", json={"enabled": False}, headers=H("host"))
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["entries"] == []
    assert until(g1, "admitted")
    send_join(g1, "g1", meeting)
    assert until(g1, "joined")
    uid(client, "g2")  # while disabled, newcomers walk straight in
    assert until(connect(stack, client, "g2", meeting), "joined")


def test_enabling_mid_meeting_keeps_people_already_inside(client, stack):
    meeting = new_meeting(client, waiting=None)
    host = connect(stack, client, "host", meeting)
    until(host, "joined")
    uid(client, "inside")
    ws = connect(stack, client, "inside", meeting)
    until(ws, "joined")
    drop(ws, host, "participant_left")
    r = client.patch(f"/api/meetings/{meeting}/waiting-room", json={"enabled": True}, headers=H("host"))
    assert r.json()["enabled"] is True
    # the person who was already in can reconnect; a newcomer has to wait
    assert until(connect(stack, client, "inside", meeting), "joined")
    uid(client, "new")
    assert until(connect(stack, client, "new", meeting), "waiting")


def test_toggle_rejects_unknown_fields(client):
    meeting = new_meeting(client)
    r = client.patch(f"/api/meetings/{meeting}/waiting-room", json={"enabled": True, "admission_mode": "x"}, headers=H("host"))
    assert r.status_code == 422


def test_meeting_end_reaches_the_lobby(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting)
    until(guest, "waiting")
    with client.Session() as db:
        from app.models import Participant

        host_pid = db.scalars(select(Participant.id).where(Participant.is_host.is_(True))).first()
    host.send_json({"type": "end_meeting", "participant_id": host_pid})
    assert until(guest, "meeting_ended")["meeting_id"] == meeting


def test_cannot_manage_an_ended_meeting(client, stack):
    meeting = new_meeting(client)
    assert client.delete(f"/api/meetings/{meeting}", headers=H("host")).status_code == 200
    assert client.get(f"/api/meetings/{meeting}/waiting-room", headers=H("host")).status_code == 409


def test_password_still_checked_before_the_lobby(client, stack):
    meeting = new_meeting(client, password="open-sesame")
    uid(client, "guest")
    ws = stack.enter_context(client.websocket_connect(f"/ws/meetings/{meeting}"))
    ws.send_json({"type": "join", "meeting_id": meeting, "display_name": "G", "token": token("guest")})
    assert until(ws, "error")["code"] == "UNAUTHORIZED_ACTION"
    assert entry_state(client, meeting, "guest") is None


# ---- invitations never bypass the meeting's own rules --------------------------------------------


def _friends(client, a, b):
    from tests.test_social import make_friends

    return make_friends(client, a, b)


def test_an_accepted_invitation_still_goes_through_the_waiting_room(client, stack):
    _, friend = _friends(client, "host", "friend")
    meeting = new_meeting(client)
    host_in(stack, client, meeting)
    assert client.post(f"/api/meetings/{meeting}/invitations", json={"user_ids": [friend]}, headers=H("host")).status_code == 200
    inv = client.get("/api/invitations", headers=H("friend")).json()[0]
    assert client.post(f"/api/invitations/{inv['id']}/accept", headers=H("friend")).json()["joinable_now"] is True
    guest = connect(stack, client, "friend", meeting)
    assert until(guest, "waiting")["type"] == "waiting"  # invited and accepted, but still must be admitted
    assert entry_state(client, meeting, "friend") == "WAITING"


def test_an_invitation_does_not_replace_the_meeting_password(client, stack):
    _, friend = _friends(client, "host", "friend")
    meeting = new_meeting(client, waiting=None, password="open-sesame")
    client.post(f"/api/meetings/{meeting}/invitations", json={"user_ids": [friend]}, headers=H("host"))
    inv = client.get("/api/invitations", headers=H("friend")).json()[0]
    assert inv["meeting"]["has_password"] is True
    client.post(f"/api/invitations/{inv['id']}/accept", headers=H("friend"))
    ws = stack.enter_context(client.websocket_connect(f"/ws/meetings/{meeting}"))
    ws.send_json({"type": "join", "meeting_id": meeting, "display_name": "F", "token": token("friend")})
    assert until(ws, "error")["message"] == "Incorrect meeting password"
    assert client.post(f"/api/meetings/{meeting}/join", json={"display_name": "F"}, headers=H("friend")).status_code == 403


# ---- more waiting-room edge cases -----------------------------------------------------------------


def test_the_lobby_survives_the_host_disconnecting_and_returning(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    uid(client, "guest")
    guest = connect(stack, client, "guest", meeting, "Gina")
    until(guest, "waiting")
    until(host, "waiting_room_updated")
    host.close()  # the host drops while someone is waiting
    quiet(guest)  # the guest simply keeps waiting; nothing is decided
    assert entry_state(client, meeting, "guest") == "WAITING"
    host2 = connect(stack, client, "host", meeting)
    until(host2, "joined")
    assert [e["display_name"] for e in until(host2, "waiting_room_updated")["entries"]] == ["Gina"]
    act(client, meeting, wait_room(client, meeting)["entries"][0]["id"], "admit")
    assert until(guest, "admitted")


def test_joining_an_ended_meeting_is_refused_before_any_waiting(client, stack):
    meeting = new_meeting(client)
    uid(client, "guest")
    assert client.delete(f"/api/meetings/{meeting}", headers=H("host")).status_code == 200
    ws = connect(stack, client, "guest", meeting)
    assert until(ws, "error")["code"] == "MEETING_ENDED"
    assert entry_state(client, meeting, "guest") is None


def test_a_meeting_that_has_not_started_cannot_be_joined_so_nobody_waits(client, stack):
    from datetime import datetime, timedelta, timezone

    when = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = client.post("/api/schedules", json={"title": "Later", "start_time": when, "duration": 30,
                                            "settings": {"waitingRoom": True}}, headers=H("host"))
    meeting = r.json()["meeting_id"]
    uid(client, "guest")
    ws = connect(stack, client, "guest", meeting)
    assert until(ws, "error")["message"] == "Meeting is not joinable"
    assert entry_state(client, meeting, "guest") is None


def test_the_host_admits_someone_who_is_reconnecting(client, stack):
    meeting = new_meeting(client)
    host = host_in(stack, client, meeting)
    uid(client, "guest")
    first = connect(stack, client, "guest", meeting)
    until(first, "waiting")
    until(host, "waiting_room_updated")
    first.close()  # the guest drops (page reload) ...
    until(host, "waiting_room_updated")
    second = connect(stack, client, "guest", meeting)  # ... and is back, waiting again
    until(second, "waiting")
    eid = wait_room(client, meeting)["entries"][0]["id"]
    act(client, meeting, eid, "admit")  # the host admits while the new socket is connected
    assert until(second, "admitted")
    send_join(second, "guest", meeting)
    assert until(second, "joined")
    assert entry_state(client, meeting, "guest") == "JOINED"
