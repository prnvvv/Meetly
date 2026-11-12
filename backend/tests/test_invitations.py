"""Friend-based meeting invitations."""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.security.ratelimit import limiter
from tests.test_auth import bearer
from tests.test_profiles import client, me  # noqa: F401  (fixtures)
from tests.test_social import H, make_friends, notes, send, uid  # noqa: F401


@pytest.fixture(autouse=True)
def _reset():
    limiter.reset()
    yield


def new_meeting(client, sub: str, **extra) -> str:
    r = client.post("/api/meetings", json={"title": "Sync", **extra}, headers=H(sub))
    assert r.status_code == 201, r.text
    return r.json()["meeting_id"]


def invite(client, sub: str, meeting: str, *ids: int):
    return client.post(f"/api/meetings/{meeting}/invitations", json={"user_ids": list(ids)}, headers=H(sub))


def received(client, sub: str, pending_only: bool = True):
    return client.get(f"/api/invitations?pending_only={str(pending_only).lower()}", headers=H(sub)).json()


def results(resp) -> dict[int, str]:
    assert resp.status_code == 200, resp.text
    return {r["user_id"]: r["result"] for r in resp.json()["results"]}


def invite_notes(client, sub: str):
    return [n for n in notes(client, sub)["items"] if n["type"] == "meeting_invitation"]


# ---- auth ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/meetings/123456789/invitations"),
        ("get", "/api/meetings/123456789/invitations"),
        ("get", "/api/invitations"),
        ("post", "/api/invitations/1/accept"),
        ("post", "/api/invitations/1/decline"),
        ("delete", "/api/invitations/1"),
    ],
)
def test_requires_authentication(client, method, path):
    assert getattr(client, method)(path).status_code == 401


# ---- happy path -------------------------------------------------------------------


def test_invite_notify_accept_flow(client):
    host, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    assert results(invite(client, "u_host", meeting, friend)) == {friend: "invited"}

    n = invite_notes(client, "u_friend")
    assert len(n) == 1 and n[0]["actor"]["user_id"] == host
    assert n[0]["payload"] == {"meeting_id": meeting, "title": "Sync"}

    inv = received(client, "u_friend")
    assert len(inv) == 1 and inv[0]["meeting"]["meeting_id"] == meeting
    assert inv[0]["inviter"]["user_id"] == host and inv[0]["meeting"]["has_password"] is False

    acc = client.post(f"/api/invitations/{inv[0]['id']}/accept", headers=H("u_friend"))
    assert acc.status_code == 200
    assert acc.json() == {
        "invitation_id": inv[0]["id"], "status": "ACCEPTED", "meeting_id": meeting,
        "has_password": False, "joinable_now": True,
    }
    assert invite_notes(client, "u_friend") == []  # the actionable notification is cleared
    assert any(x["type"] == "meeting_invitation_accepted" for x in notes(client, "u_host")["items"])
    assert received(client, "u_friend") == []
    # idempotent
    assert client.post(f"/api/invitations/{inv[0]['id']}/accept", headers=H("u_friend")).status_code == 200
    assert len([x for x in notes(client, "u_host")["items"] if x["type"] == "meeting_invitation_accepted"]) == 1


def test_invite_multiple_friends_and_reject_non_friends(client):
    host, f1 = make_friends(client, "u_host", "u_f1")
    _, f2 = make_friends(client, "u_host", "u_f2")
    stranger = uid(client, "u_stranger")
    meeting = new_meeting(client, "u_host")
    r = results(invite(client, "u_host", meeting, f1, f2, stranger, host, 99999))
    assert r == {f1: "invited", f2: "invited", stranger: "unavailable", host: "unavailable", 99999: "unavailable"}
    assert len(invite_notes(client, "u_f1")) == 1 and invite_notes(client, "u_stranger") == []


def test_duplicate_invite_is_idempotent(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    assert results(invite(client, "u_host", meeting, friend)) == {friend: "invited"}
    assert results(invite(client, "u_host", meeting, friend, friend)) == {friend: "already_invited"}
    assert len(invite_notes(client, "u_friend")) == 1 and len(received(client, "u_friend")) == 1


def test_decline_is_silent_and_reinvite_works(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    invite(client, "u_host", meeting, friend)
    iid = received(client, "u_friend")[0]["id"]
    assert client.post(f"/api/invitations/{iid}/decline", headers=H("u_friend")).json()["status"] == "DECLINED"
    assert client.post(f"/api/invitations/{iid}/decline", headers=H("u_friend")).status_code == 200
    assert client.post(f"/api/invitations/{iid}/accept", headers=H("u_friend")).status_code == 409
    assert not [n for n in notes(client, "u_host")["items"] if "invitation" in n["type"]]
    assert received(client, "u_friend") == []

    assert results(invite(client, "u_host", meeting, friend)) == {friend: "reinvited"}
    assert len(invite_notes(client, "u_friend")) == 1
    assert client.post(f"/api/invitations/{iid}/accept", headers=H("u_friend")).status_code == 200


def test_scheduled_meeting_can_be_invited_but_not_joined_yet(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    from datetime import datetime, timezone

    when = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = client.post("/api/schedules", json={"title": "Later", "start_time": when, "duration": 30}, headers=H("u_host"))
    assert r.status_code == 201, r.text
    meeting = r.json()["meeting_id"]
    assert results(invite(client, "u_host", meeting, friend)) == {friend: "invited"}
    iid = received(client, "u_friend")[0]["id"]
    acc = client.post(f"/api/invitations/{iid}/accept", headers=H("u_friend")).json()
    assert acc["joinable_now"] is False


def test_password_is_never_exposed(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host", password="s3cret-pass")
    invite(client, "u_host", meeting, friend)
    inv = client.get("/api/invitations", headers=H("u_friend"))
    assert inv.json()[0]["meeting"]["has_password"] is True
    iid = inv.json()[0]["id"]
    acc = client.post(f"/api/invitations/{iid}/accept", headers=H("u_friend"))
    for text in (inv.text, acc.text, client.get("/api/notifications", headers=H("u_friend")).text):
        assert "s3cret-pass" not in text and "password_hash" not in text and "$2b$" not in text
    assert acc.json()["has_password"] is True


# ---- authorization ----------------------------------------------------------------------


def test_outsider_cannot_invite_or_list(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    make_friends(client, "u_out", "u_friend")
    meeting = new_meeting(client, "u_host")
    assert invite(client, "u_out", meeting, friend).status_code == 404
    assert client.get(f"/api/meetings/{meeting}/invitations", headers=H("u_out")).status_code == 404
    assert received(client, "u_friend") == []


def test_unknown_meeting_is_404(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    assert invite(client, "u_host", "987654321", friend).status_code == 404


def test_participant_can_invite_own_friends_and_sees_only_own(client):
    host, _ = make_friends(client, "u_host", "u_f_host")
    guest, f_guest = make_friends(client, "u_guest", "u_f_guest")
    meeting = new_meeting(client, "u_host")
    from app.models import Meeting, Participant
    from sqlalchemy import select

    with client.Session() as db:
        m = db.scalars(select(Meeting).where(Meeting.meeting_id == meeting)).one()
        db.add(Participant(meeting_id=m.id, user_id=guest, display_name="Guest"))
        db.commit()
    assert results(invite(client, "u_guest", meeting, f_guest)) == {f_guest: "invited"}
    # guest cannot invite the host's friend (not their friend)
    host_friend = uid(client, "u_f_host")
    assert results(invite(client, "u_guest", meeting, host_friend)) == {host_friend: "unavailable"}
    assert [i["person"]["user_id"] for i in client.get(f"/api/meetings/{meeting}/invitations", headers=H("u_guest")).json()] == [f_guest]
    invite(client, "u_host", meeting, host_friend)
    assert len(client.get(f"/api/meetings/{meeting}/invitations", headers=H("u_host")).json()) == 2


def test_only_invitee_can_respond(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    invite(client, "u_host", meeting, friend)
    iid = received(client, "u_friend")[0]["id"]
    for who in ("u_host", "u_other"):
        assert client.post(f"/api/invitations/{iid}/accept", headers=H(who)).status_code == 404
        assert client.post(f"/api/invitations/{iid}/decline", headers=H(who)).status_code == 404
    assert received(client, "u_other") == []
    assert client.post("/api/invitations/99999/accept", headers=H("u_friend")).status_code == 404


def test_only_inviter_or_host_can_cancel(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    invite(client, "u_host", meeting, friend)
    iid = received(client, "u_friend")[0]["id"]
    for who in ("u_friend", "u_other"):
        assert client.delete(f"/api/invitations/{iid}", headers=H(who)).status_code == 404
    assert client.delete(f"/api/invitations/{iid}", headers=H("u_host")).status_code == 204
    assert client.delete(f"/api/invitations/{iid}", headers=H("u_host")).status_code == 204
    assert invite_notes(client, "u_friend") == [] and received(client, "u_friend") == []
    assert client.post(f"/api/invitations/{iid}/accept", headers=H("u_friend")).status_code == 409


# ---- state -------------------------------------------------------------------------------


def test_ended_meeting_rejects_invites_and_acceptance(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    invite(client, "u_host", meeting, friend)
    iid = received(client, "u_friend")[0]["id"]
    assert client.delete(f"/api/meetings/{meeting}", headers=H("u_host")).status_code == 200
    assert invite(client, "u_host", meeting, friend).status_code == 409
    assert client.post(f"/api/invitations/{iid}/accept", headers=H("u_friend")).status_code == 409
    assert received(client, "u_friend") == []


def test_expired_invitations_are_hidden_and_cannot_be_accepted(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    invite(client, "u_host", meeting, friend)
    iid = received(client, "u_friend")[0]["id"]
    from sqlalchemy import update
    from app.database.database import utc_now
    from app.models import MeetingInvitation

    with client.Session() as db:
        db.execute(update(MeetingInvitation).values(expires_at=utc_now() - timedelta(minutes=1)))
        db.commit()
    assert received(client, "u_friend") == []
    assert [i["status"] for i in received(client, "u_friend", pending_only=False)] == ["EXPIRED"]
    r = client.post(f"/api/invitations/{iid}/accept", headers=H("u_friend"))
    assert r.status_code == 409 and "expired" in r.json()["detail"]
    assert results(invite(client, "u_host", meeting, friend)) == {friend: "reinvited"}


# ---- blocking -------------------------------------------------------------------------------


def test_block_withdraws_pending_invitations_and_prevents_new_ones(client):
    host, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    invite(client, "u_host", meeting, friend)
    assert client.post(f"/api/users/{host}/block", headers=H("u_friend")).status_code == 204
    assert received(client, "u_friend") == [] and invite_notes(client, "u_friend") == []
    assert results(invite(client, "u_host", meeting, friend)) == {friend: "unavailable"}


def test_block_does_not_touch_accepted_invitation(client):
    host, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    invite(client, "u_host", meeting, friend)
    iid = received(client, "u_friend")[0]["id"]
    client.post(f"/api/invitations/{iid}/accept", headers=H("u_friend"))
    client.post(f"/api/users/{host}/block", headers=H("u_friend"))
    from app.models import MeetingInvitation
    from sqlalchemy import select

    with client.Session() as db:
        assert db.scalars(select(MeetingInvitation.status)).one() == "ACCEPTED"


def test_removed_friend_cannot_be_invited(client):
    _, friend = make_friends(client, "u_host", "u_friend")
    client.delete(f"/api/friends/{friend}", headers=H("u_host"))
    meeting = new_meeting(client, "u_host")
    assert results(invite(client, "u_host", meeting, friend)) == {friend: "unavailable"}


# ---- validation -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [{}, {"user_ids": []}, {"user_ids": list(range(1, 52))}, {"user_ids": ["a"]}, {"user_ids": [1], "inviter_id": 5}],
)
def test_invalid_bodies_rejected(client, body):
    meeting = new_meeting(client, "u_host")
    r = client.post(f"/api/meetings/{meeting}/invitations", json=body, headers=H("u_host"))
    assert r.status_code == 422


def test_concurrent_invites_create_single_invitation(client):
    import threading

    _, friend = make_friends(client, "u_host", "u_friend")
    meeting = new_meeting(client, "u_host")
    barrier = threading.Barrier(4)
    codes: list[int] = []

    def go():
        barrier.wait()
        codes.append(invite(client, "u_host", meeting, friend).status_code)

    ts = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert all(c == 200 for c in codes), codes
    assert len(received(client, "u_friend")) == 1 and len(invite_notes(client, "u_friend")) == 1
