"""Friends, blocking, people search and notifications, with several real identities."""

from __future__ import annotations

import threading

import pytest

from app.security.ratelimit import limiter
from tests.test_auth import bearer
from tests.test_profiles import client, me, png_bytes, put_avatar  # noqa: F401  (fixtures)


def uid(client, sub: str) -> int:
    return me(client, sub)["user_id"]


def H(sub: str) -> dict:
    return bearer(sub)


def send(client, frm: str, to: int, expect: int | None = None):
    r = client.post("/api/friends/requests", json={"user_id": to}, headers=H(frm))
    if expect is not None:
        assert r.status_code == expect, r.text
    return r


def make_friends(client, a: str, b: str) -> tuple[int, int]:
    ua, ub = uid(client, a), uid(client, b)
    rid = send(client, a, ub, 201).json()["request_id"]
    assert client.post(f"/api/friends/requests/{rid}/accept", headers=H(b)).status_code == 200
    return ua, ub


def friends_of(client, sub: str) -> list[int]:
    return [p["user_id"] for p in client.get("/api/friends", headers=H(sub)).json()["items"]]


def notes(client, sub: str) -> dict:
    return client.get("/api/notifications", headers=H(sub)).json()


def name(client, sub: str, username: str, **extra):
    r = client.patch("/api/users/me/profile", headers=H(sub), json={"username": username, **extra})
    assert r.status_code == 200, r.text
    return r.json()


# ---- auth ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/users/search?q=ab"),
        ("get", "/api/users/discover"),
        ("get", "/api/friends"),
        ("get", "/api/friends/requests/incoming"),
        ("post", "/api/friends/requests"),
        ("delete", "/api/friends/1"),
        ("post", "/api/users/1/block"),
        ("get", "/api/blocks"),
        ("get", "/api/notifications"),
        ("post", "/api/notifications/read-all"),
        ("patch", "/api/notifications/1/read"),
    ],
)
def test_all_social_endpoints_require_auth(client, method, path):
    assert getattr(client, method)(path).status_code == 401


# ---- search -----------------------------------------------------------------------------


def test_search_by_username_and_display_name(client):
    name(client, "u_a", "alice_w", display_name="Alice Wonder")
    name(client, "u_b", "bob_builder", display_name="Bob Builder")
    name(client, "u_c", "carol")
    r = client.get("/api/users/search?q=alice", headers=H("u_c")).json()
    assert [p["username"] for p in r["items"]] == ["alice_w"]
    r = client.get("/api/users/search?q=BUILDER", headers=H("u_c")).json()
    assert [p["username"] for p in r["items"]] == ["bob_builder"]
    assert set(r["items"][0]) == {
        "user_id", "username", "display_name", "avatar_url", "designation", "relationship", "request_id",
    }


def test_search_excludes_self_private_and_short_queries(client):
    name(client, "u_a", "alice_w")
    name(client, "u_b", "alice_hidden", visibility="private")
    assert [p["username"] for p in client.get("/api/users/search?q=alice", headers=H("u_a")).json()["items"]] == []
    out = client.get("/api/users/search?q=alice", headers=H("u_b")).json()["items"]
    assert [p["username"] for p in out] == ["alice_w"]
    assert client.get("/api/users/search?q=a", headers=H("u_b")).json() == {"items": [], "has_more": False}


def test_search_wildcards_are_literal(client):
    name(client, "u_a", "alice_w")
    assert client.get("/api/users/search?q=%25%25", headers=H("u_b")).json()["items"] == []
    assert client.get("/api/users/search?q=a_i", headers=H("u_b")).json()["items"] == []


def test_search_pagination(client):
    for i in range(5):
        name(client, f"u_{i}", f"zed_user{i}")
    page1 = client.get("/api/users/search?q=zed_&limit=2", headers=H("viewer")).json()
    assert len(page1["items"]) == 2 and page1["has_more"] is True
    page3 = client.get("/api/users/search?q=zed_&limit=2&offset=4", headers=H("viewer")).json()
    assert len(page3["items"]) == 1 and page3["has_more"] is False


def test_search_hides_blocked_both_directions_and_shows_relationship(client):
    name(client, "u_a", "alice_w")
    name(client, "u_b", "alice_b")
    a, b = uid(client, "u_a"), uid(client, "u_b")
    rid = send(client, "u_c", a, 201).json()["request_id"]
    found = {p["username"]: p for p in client.get("/api/users/search?q=alice", headers=H("u_c")).json()["items"]}
    assert found["alice_w"]["relationship"] == "request_sent" and found["alice_w"]["request_id"] == rid
    assert found["alice_b"]["relationship"] == "none"
    assert client.post(f"/api/users/{b}/block", headers=H("u_c")).status_code == 204
    names = [p["username"] for p in client.get("/api/users/search?q=alice", headers=H("u_c")).json()["items"]]
    assert names == ["alice_w"]
    # and the blocked user cannot find the blocker
    name(client, "u_c", "alice_c")
    assert "alice_c" not in [p["username"] for p in client.get("/api/users/search?q=alice", headers=H("u_b")).json()["items"]]


def test_search_rate_limited(client):
    codes = [client.get("/api/users/search?q=zz", headers=H("u_a")).status_code for _ in range(42)]
    assert codes[:40] == [200] * 40 and 429 in codes[40:]


def test_search_never_leaks_email_or_clerk_id(client):
    name(client, "u_a", "alice_w")
    text = client.get("/api/users/search?q=alice", headers=H("u_b")).text
    assert "@" not in text and "user_a" not in text and "u_a" not in text


# ---- request lifecycle ---------------------------------------------------------------------


def test_send_accept_flow_creates_friendship_and_notifications(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    r = send(client, "u_a", b, 201).json()
    assert r["status"] == "PENDING" and r["friendship_created"] is False
    inc = client.get("/api/friends/requests/incoming", headers=H("u_b")).json()
    out = client.get("/api/friends/requests/outgoing", headers=H("u_a")).json()
    assert [x["person"]["user_id"] for x in inc] == [a] and [x["person"]["user_id"] for x in out] == [b]

    n = notes(client, "u_b")
    assert n["unread_count"] == 1 and n["items"][0]["type"] == "friend_request"
    assert n["items"][0]["actor"]["user_id"] == a

    acc = client.post(f"/api/friends/requests/{r['request_id']}/accept", headers=H("u_b"))
    assert acc.status_code == 200 and acc.json()["friendship_created"] is True
    assert friends_of(client, "u_a") == [b] and friends_of(client, "u_b") == [a]
    assert notes(client, "u_b")["items"] == []  # the request notification is cleared
    assert notes(client, "u_a")["items"][0]["type"] == "friend_request_accepted"
    assert client.get("/api/friends/requests/incoming", headers=H("u_b")).json() == []


def test_duplicate_send_is_idempotent(client):
    b = uid(client, "u_b")
    first = send(client, "u_a", b, 201).json()
    second = send(client, "u_a", b).json()
    assert first["request_id"] == second["request_id"]
    assert len(client.get("/api/friends/requests/outgoing", headers=H("u_a")).json()) == 1
    assert len(notes(client, "u_b")["items"]) == 1


def test_accept_is_idempotent_and_does_not_duplicate_notifications(client):
    b = uid(client, "u_b")
    rid = send(client, "u_a", b, 201).json()["request_id"]
    for _ in range(3):
        assert client.post(f"/api/friends/requests/{rid}/accept", headers=H("u_b")).status_code == 200
    assert len(friends_of(client, "u_a")) == 1
    assert len(notes(client, "u_a")["items"]) == 1


def test_reject_is_silent_and_sets_cooldown(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    rid = send(client, "u_a", b, 201).json()["request_id"]
    assert client.post(f"/api/friends/requests/{rid}/reject", headers=H("u_b")).json()["status"] == "REJECTED"
    assert notes(client, "u_a")["items"] == [] and notes(client, "u_b")["items"] == []
    assert friends_of(client, "u_a") == []
    assert send(client, "u_a", b).status_code == 429  # cannot spam after a rejection
    # the rejected person may still send their own request the other way
    assert send(client, "u_b", a).status_code == 201


def test_cancel_removes_receiver_notification(client):
    b = uid(client, "u_b")
    rid = send(client, "u_a", b, 201).json()["request_id"]
    assert notes(client, "u_b")["unread_count"] == 1
    assert client.delete(f"/api/friends/requests/{rid}", headers=H("u_a")).json()["status"] == "CANCELLED"
    assert notes(client, "u_b") ["unread_count"] == 0
    assert client.get("/api/friends/requests/incoming", headers=H("u_b")).json() == []
    # can send again after cancelling
    assert send(client, "u_a", b).status_code == 201


def test_invalid_transitions_rejected(client):
    b = uid(client, "u_b")
    rid = send(client, "u_a", b, 201).json()["request_id"]
    client.post(f"/api/friends/requests/{rid}/accept", headers=H("u_b"))
    assert client.post(f"/api/friends/requests/{rid}/reject", headers=H("u_b")).status_code == 409
    assert client.delete(f"/api/friends/requests/{rid}", headers=H("u_a")).status_code == 409


def test_only_receiver_can_respond_only_sender_can_cancel(client):
    b = uid(client, "u_b")
    rid = send(client, "u_a", b, 201).json()["request_id"]
    for who in ("u_a", "u_c"):  # sender cannot accept own request; stranger cannot either
        assert client.post(f"/api/friends/requests/{rid}/accept", headers=H(who)).status_code == 404
        assert client.post(f"/api/friends/requests/{rid}/reject", headers=H(who)).status_code == 404
    for who in ("u_b", "u_c"):
        assert client.delete(f"/api/friends/requests/{rid}", headers=H(who)).status_code == 404
    assert friends_of(client, "u_a") == []


def test_self_and_unknown_targets(client):
    a = uid(client, "u_a")
    assert send(client, "u_a", a).status_code == 400
    assert send(client, "u_a", 99999).status_code == 404
    assert client.post("/api/friends/requests", json={"user_id": 0}, headers=H("u_a")).status_code == 422
    assert client.post("/api/friends/requests", json={"user_id": 2, "sender_id": 5}, headers=H("u_a")).status_code == 422


def test_cannot_request_private_profile_or_existing_friend(client):
    name(client, "u_b", "bee", visibility="private")
    b = uid(client, "u_b")
    assert send(client, "u_a", b).status_code == 404
    make_friends(client, "u_c", "u_d")
    assert send(client, "u_c", uid(client, "u_d")).status_code == 409


def test_reciprocal_requests_become_one_friendship(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    send(client, "u_a", b, 201)
    r = send(client, "u_b", a)  # b answers a pending request from a by requesting a
    assert r.status_code == 200 and r.json()["status"] == "ACCEPTED" and r.json()["friendship_created"] is True
    assert friends_of(client, "u_a") == [b]
    assert client.get("/api/friends/requests/outgoing", headers=H("u_a")).json() == []


def test_simultaneous_requests_create_exactly_one_friendship(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    barrier = threading.Barrier(2)
    results: list[int] = []

    def go(frm, to):
        barrier.wait()
        results.append(send(client, frm, to).status_code)

    threads = [threading.Thread(target=go, args=("u_a", b)), threading.Thread(target=go, args=("u_b", a))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert all(code in (200, 201) for code in results), results
    assert friends_of(client, "u_a") == [b] and friends_of(client, "u_b") == [a]
    from app.models import FriendRequest, Friendship
    from sqlalchemy import func, select

    with client.Session() as db:
        assert db.scalar(select(func.count()).select_from(Friendship)) == 1
        pending = db.scalar(select(func.count()).select_from(FriendRequest).where(FriendRequest.status == "PENDING"))
        assert pending == 0


def test_concurrent_accepts_create_one_friendship(client):
    b = uid(client, "u_b")
    rid = send(client, "u_a", b, 201).json()["request_id"]
    barrier = threading.Barrier(4)
    codes: list[int] = []

    def go():
        barrier.wait()
        codes.append(client.post(f"/api/friends/requests/{rid}/accept", headers=H("u_b")).status_code)

    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert set(codes) <= {200, 409, 500} and 200 in codes
    assert friends_of(client, "u_a") == [b]


def test_remove_friend(client):
    a, b = make_friends(client, "u_a", "u_b")
    assert client.delete(f"/api/friends/{b}", headers=H("u_a")).status_code == 204
    assert friends_of(client, "u_a") == [] and friends_of(client, "u_b") == []
    assert client.delete(f"/api/friends/{b}", headers=H("u_a")).status_code == 404
    assert send(client, "u_a", b).status_code == 201  # can befriend again


def test_friends_list_search_and_pagination(client):
    name(client, "u_a", "me_a")
    for i in range(3):
        name(client, f"f{i}", f"friend{i}", display_name=f"Friend Number {i}")
        make_friends(client, "u_a", f"f{i}")
    assert len(client.get("/api/friends?limit=2", headers=H("u_a")).json()["items"]) == 2
    r = client.get("/api/friends?q=number 1", headers=H("u_a")).json()["items"]
    assert [p["username"] for p in r] == ["friend1"] and r[0]["relationship"] == "friend"


# ---- blocking ---------------------------------------------------------------------------------


def test_block_removes_friendship_and_pending_requests(client):
    a, b = make_friends(client, "u_a", "u_b")
    assert client.post(f"/api/users/{b}/block", headers=H("u_a")).status_code == 204
    assert friends_of(client, "u_a") == [] and friends_of(client, "u_b") == []
    blocked = client.get("/api/blocks", headers=H("u_a")).json()["items"]
    assert [p["user_id"] for p in blocked] == [b] and blocked[0]["relationship"] == "blocked"
    assert client.get("/api/blocks", headers=H("u_b")).json()["items"] == []


def test_block_cancels_pending_request_and_blocks_new_ones(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    send(client, "u_b", a, 201)
    assert client.post(f"/api/users/{b}/block", headers=H("u_a")).status_code == 204
    assert client.get("/api/friends/requests/incoming", headers=H("u_a")).json() == []
    assert notes(client, "u_a")["unread_count"] == 0
    assert send(client, "u_b", a).status_code == 404  # blocked: indistinguishable from unknown
    assert send(client, "u_a", b).status_code == 404


def test_blocked_user_cannot_view_blocker_profile_or_accept_old_request(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    rid = send(client, "u_a", b, 201).json()["request_id"]
    client.post(f"/api/users/{a}/block", headers=H("u_b"))  # b blocks a
    assert client.get(f"/api/users/{b}/profile", headers=H("u_a")).status_code == 404
    assert client.get(f"/api/users/{a}/profile", headers=H("u_b")).status_code == 404
    assert client.post(f"/api/friends/requests/{rid}/accept", headers=H("u_b")).status_code in (403, 409)
    assert friends_of(client, "u_a") == []


def test_block_is_idempotent_unblock_restores(client):
    b = uid(client, "u_b")
    for _ in range(2):
        assert client.post(f"/api/users/{b}/block", headers=H("u_a")).status_code == 204
    assert len(client.get("/api/blocks", headers=H("u_a")).json()["items"]) == 1
    assert client.delete(f"/api/users/{b}/block", headers=H("u_a")).status_code == 204
    assert client.delete(f"/api/users/{b}/block", headers=H("u_a")).status_code == 204
    assert client.get("/api/blocks", headers=H("u_a")).json()["items"] == []
    assert send(client, "u_a", b).status_code == 201


def test_cannot_block_self_or_unknown(client):
    a = uid(client, "u_a")
    assert client.post(f"/api/users/{a}/block", headers=H("u_a")).status_code == 400
    assert client.post("/api/users/99999/block", headers=H("u_a")).status_code == 404


def test_blocked_users_notifications_hidden(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    send(client, "u_b", a, 201)
    assert notes(client, "u_a")["unread_count"] == 1
    client.post(f"/api/users/{b}/block", headers=H("u_a"))
    assert notes(client, "u_a")["items"] == []


# ---- privacy interplay ---------------------------------------------------------------------------


def test_friends_only_profile_becomes_visible_after_friendship(client):
    put_avatar(client, png_bytes(), sub="u_a")
    name(client, "u_a", "private_pal", visibility="friends", bio="inner circle")
    a = uid(client, "u_a")
    assert client.get(f"/api/users/{a}/profile", headers=H("u_b")).json()["limited"] is True
    make_friends(client, "u_a", "u_b")
    full = client.get(f"/api/users/{a}/profile", headers=H("u_b")).json()
    assert full["limited"] is False and full["bio"] == "inner circle" and full["avatar_url"]
    client.delete(f"/api/friends/{uid(client, 'u_b')}", headers=H("u_a"))
    assert client.get(f"/api/users/{a}/profile", headers=H("u_b")).json()["limited"] is True


def test_private_profile_friend_still_listed_with_minimal_card(client):
    name(client, "u_a", "hidden_pal", visibility="private")
    make_friends(client, "u_b", "u_a") if False else None
    # friend first, then go private
    name(client, "u_a", "hidden_pal", visibility="public")
    make_friends(client, "u_b", "u_a")
    name(client, "u_a", "hidden_pal", visibility="private")
    item = client.get("/api/friends", headers=H("u_b")).json()["items"][0]
    assert item["username"] == "hidden_pal" and item["avatar_url"] is None


# ---- discovery ---------------------------------------------------------------------------------------


def test_discover_suggests_people_from_shared_meetings(client):
    a, b = uid(client, "u_a"), uid(client, "u_b")
    c = uid(client, "u_c")
    from app.models import Meeting, MeetingStatus, Participant
    from app.utils.datetime_utils import utc_now

    with client.Session() as db:
        m = Meeting(meeting_id="123456789", host_id=a, title="t", start_time=utc_now(),
                    status=MeetingStatus.ACTIVE, meeting_link="x")
        db.add(m)
        db.commit()
        db.add_all([Participant(meeting_id=m.id, user_id=a, display_name="A", is_host=True),
                    Participant(meeting_id=m.id, user_id=b, display_name="B")])
        db.commit()
    ids = [p["user_id"] for p in client.get("/api/users/discover", headers=H("u_a")).json()["items"]]
    assert ids == [b] and c not in ids
    make_friends(client, "u_a", "u_b")
    assert client.get("/api/users/discover", headers=H("u_a")).json()["items"] == []


# ---- notifications ------------------------------------------------------------------------------------


def test_notifications_read_and_read_all_and_pagination(client):
    a = uid(client, "u_a")
    for i in range(5):
        send(client, f"s{i}", a, 201)
    page = client.get("/api/notifications?limit=2", headers=H("u_a")).json()
    assert page["unread_count"] == 5 and len(page["items"]) == 2 and page["next_before_id"]
    nxt = client.get(f"/api/notifications?limit=2&before_id={page['next_before_id']}", headers=H("u_a")).json()
    assert len(nxt["items"]) == 2 and nxt["items"][0]["id"] < page["items"][-1]["id"]
    first = page["items"][0]["id"]
    assert client.patch(f"/api/notifications/{first}/read", headers=H("u_a")).status_code == 204
    assert client.patch(f"/api/notifications/{first}/read", headers=H("u_a")).status_code == 204
    assert notes(client, "u_a")["unread_count"] == 4
    assert client.get("/api/notifications?unread_only=true&limit=50", headers=H("u_a")).json()["items"].__len__() == 4
    assert client.post("/api/notifications/read-all", headers=H("u_a")).json() == {"updated": 4}
    assert notes(client, "u_a")["unread_count"] == 0


def test_cannot_read_someone_elses_notification(client):
    a = uid(client, "u_a")
    send(client, "u_b", a, 201)
    nid = notes(client, "u_a")["items"][0]["id"]
    assert client.patch(f"/api/notifications/{nid}/read", headers=H("u_b")).status_code == 404
    assert client.patch("/api/notifications/99999/read", headers=H("u_a")).status_code == 404
    assert notes(client, "u_a")["unread_count"] == 1
    assert notes(client, "u_b")["items"] == []


def test_expired_notifications_are_not_listed(client):
    a = uid(client, "u_a")
    send(client, "u_b", a, 201)
    from datetime import timedelta
    from sqlalchemy import update
    from app.database.database import utc_now
    from app.models import Notification

    with client.Session() as db:
        db.execute(update(Notification).values(expires_at=utc_now() - timedelta(days=1)))
        db.commit()
    n = notes(client, "u_a")
    assert n["items"] == [] and n["unread_count"] == 0


# ---- realtime ---------------------------------------------------------------------------------------------


def test_notification_socket_pushes_change_hint(client):
    a = uid(client, "u_a")
    token = H("u_a")["Authorization"].split()[1]
    with client.websocket_connect("/ws/notifications") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json() == {"type": "ready"}
        send(client, "u_b", a, 201)
        assert ws.receive_json() == {"type": "notifications_changed"}
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_notification_socket_rejects_bad_auth(client):
    with client.websocket_connect("/ws/notifications") as ws:
        ws.send_json({"type": "auth", "token": "not-a-jwt"})
        assert ws.receive_json()["type"] == "error"
    with client.websocket_connect("/ws/notifications") as ws:
        ws.send_json({"type": "hello"})
        with pytest.raises(Exception):
            ws.receive_json()


def test_user_only_receives_own_events(client):
    a = uid(client, "u_a")
    uid(client, "u_c")
    token_c = H("u_c")["Authorization"].split()[1]
    with client.websocket_connect("/ws/notifications") as ws_c:
        ws_c.send_json({"type": "auth", "token": token_c})
        assert ws_c.receive_json() == {"type": "ready"}
        send(client, "u_b", a, 201)  # concerns a only
        ws_c.send_json({"type": "ping"})
        assert ws_c.receive_json() == {"type": "pong"}  # first message after ready is the pong


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()
    yield


@pytest.fixture(autouse=True)
def _socket_uses_test_database(client, monkeypatch):
    """The notification socket opens its own session; point it at the test database."""
    from app.websocket import user_channel

    monkeypatch.setattr(user_channel, "SessionLocal", client.Session)
