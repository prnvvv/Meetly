"""Security hardening: headers, CORS, size limits, WebSocket origin, brute force,
information exposure, token attacks, concurrency."""

from __future__ import annotations

import base64
import json
import logging
import threading
import time

import jwt
import pytest
from sqlalchemy import func, select
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.models import Participant
from app.security.ratelimit import limiter
from tests.test_auth import ISSUER, _KEY, _OTHER_KEY, bearer, make_token
from tests.test_profiles import client, me  # noqa: F401  (fixtures)
from tests.test_social import H, uid  # noqa: F401

ALLOWED = settings.cors_origins[0]


@pytest.fixture(autouse=True)
def _reset():
    limiter.reset()
    yield


def new_meeting(client, sub="host", **extra) -> str:
    r = client.post("/api/meetings", json={"title": "Sync", **extra}, headers=H(sub))
    assert r.status_code == 201, r.text
    return r.json()["meeting_id"]


# ---- headers ----------------------------------------------------------------------


def test_security_headers_on_every_response(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    api = client.get("/api/users/me", headers=H("u"))
    assert api.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in api.headers  # only in production


def test_hsts_in_production(client, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    assert "max-age" in client.get("/health").headers["strict-transport-security"]


# ---- CORS ---------------------------------------------------------------------------


def test_cors_allows_only_configured_origin_without_credentials(client):
    ok = client.options(
        "/api/users/me",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"},
    )
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == ALLOWED
    assert "access-control-allow-credentials" not in ok.headers
    assert "TRACE" not in ok.headers["access-control-allow-methods"]


def test_cors_rejects_other_origins_and_headers(client):
    evil = client.options(
        "/api/users/me",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in evil.headers
    simple = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in simple.headers
    bad_header = client.options(
        "/api/users/me",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-secret"},
    )
    assert bad_header.status_code == 400


def test_no_wildcard_origin(client):
    r = client.options("/health", headers={"Origin": ALLOWED, "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") != "*"


# ---- request size ----------------------------------------------------------------------


def test_oversized_json_body_rejected_before_processing(client):
    big = json.dumps({"title": "x" * (1024 * 1024 + 10)})
    r = client.post("/api/meetings", content=big, headers={**H("host"), "Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"detail": "Request body is too large"}


def test_oversized_streamed_body_rejected_without_content_length(client):
    def chunks():
        for _ in range(12):
            yield b"x" * (128 * 1024)

    r = client.post("/api/meetings", content=chunks(), headers={**H("host"), "Content-Type": "application/json"})
    assert r.status_code == 413


def test_normal_requests_and_gets_are_unaffected(client):
    assert client.post("/api/meetings", json={"title": "ok"}, headers=H("host")).status_code == 201
    assert client.get("/api/users/me", headers=H("host")).status_code == 200


def test_avatar_endpoint_has_its_own_larger_limit(client):
    r = client.put("/api/users/me/avatar", content=b"\x00" * (2 * 1024 * 1024 + 200 * 1024), headers=H("u"))
    assert r.status_code == 413
    r = client.put("/api/users/me/avatar", content=b"\x00" * 1000, headers=H("u"))
    assert r.status_code == 422  # reaches the image validator, which rejects it


# ---- WebSocket origin ---------------------------------------------------------------------


def test_meeting_socket_refuses_foreign_browser_origin(client):
    meeting = new_meeting(client)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/meetings/{meeting}", headers={"Origin": "https://evil.example"}):
            pass


def test_notification_socket_refuses_foreign_browser_origin(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/notifications", headers={"Origin": "https://evil.example"}):
            pass


def test_sockets_accept_the_real_frontend_origin_and_non_browser_clients(client):
    meeting = new_meeting(client)
    token = H("host")["Authorization"].split()[1]
    for headers in ({"Origin": ALLOWED}, {}):
        with client.websocket_connect(f"/ws/meetings/{meeting}", headers=headers) as ws:
            ws.send_json({"type": "join", "meeting_id": meeting, "display_name": "H", "token": token})
            assert ws.receive_json()["type"] == "joined"


# ---- brute force ------------------------------------------------------------------------------


def test_rest_join_password_guessing_is_limited(client):
    meeting = new_meeting(client, password="correct-horse")
    uid(client, "guest")
    codes = [
        client.post(f"/api/meetings/{meeting}/join", json={"display_name": "G", "password": f"guess{i}"}, headers=H("guest")).status_code
        for i in range(12)
    ]
    assert codes[:10] == [403] * 10 and codes[10:] == [429, 429]
    # the right password is also refused while locked out, and other users are unaffected
    assert client.post(f"/api/meetings/{meeting}/join", json={"display_name": "G", "password": "correct-horse"}, headers=H("guest")).status_code == 429
    uid(client, "other")
    assert client.post(f"/api/meetings/{meeting}/join", json={"display_name": "O", "password": "correct-horse"}, headers=H("other")).status_code == 200


def test_websocket_password_guessing_is_limited(client):
    meeting = new_meeting(client, password="correct-horse")
    uid(client, "guest")
    token = H("guest")["Authorization"].split()[1]
    messages = []
    for i in range(12):
        with client.websocket_connect(f"/ws/meetings/{meeting}") as ws:
            ws.send_json({"type": "join", "meeting_id": meeting, "display_name": "G", "password": f"guess{i}", "token": token})
            messages.append(ws.receive_json()["message"])
    assert messages[:10] == ["Incorrect meeting password"] * 10
    assert all("Too many" in m for m in messages[10:])


def test_unauthenticated_socket_cannot_probe_the_password(client):
    meeting = new_meeting(client, password="correct-horse")
    for password in ("wrong", "correct-horse"):
        with client.websocket_connect(f"/ws/meetings/{meeting}") as ws:
            ws.send_json({"type": "join", "meeting_id": meeting, "display_name": "X", "password": password})
            msg = ws.receive_json()
            assert msg["message"] == "Sign in to join this meeting"  # identical either way


# ---- information exposure --------------------------------------------------------------------------


def test_outsiders_see_a_meeting_but_not_its_notes_or_settings(client):
    meeting = new_meeting(client, description="private agenda", settings={"lockMeeting": False, "allowChat": True})
    uid(client, "outsider")
    seen = client.get(f"/api/meetings/{meeting}", headers=H("outsider")).json()
    assert seen["title"] == "Sync" and seen["description"] is None and seen["settings"] == {}
    mine = client.get(f"/api/meetings/{meeting}", headers=H("host")).json()
    assert mine["description"] == "private agenda" and mine["settings"]["allowChat"] is True
    # a participant gets the full record
    token = H("outsider")["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/meetings/{meeting}") as ws:
        ws.send_json({"type": "join", "meeting_id": meeting, "display_name": "O", "token": token})
        assert ws.receive_json()["type"] == "joined"
    assert client.get(f"/api/meetings/{meeting}", headers=H("outsider")).json()["description"] == "private agenda"


def test_meeting_responses_never_contain_password_material(client):
    meeting = new_meeting(client, password="s3cret-pass")
    for sub in ("host", "stranger"):
        text = client.get(f"/api/meetings/{meeting}", headers=H(sub)).text
        assert "s3cret-pass" not in text and "password_hash" not in text and "$2b$" not in text


def test_server_errors_are_generic_and_leak_nothing(client, monkeypatch):
    from app.services import meeting_service

    def boom(*a, **k):
        raise RuntimeError("postgresql://user:SECRETPW@db.internal/prod failed")

    monkeypatch.setattr(meeting_service, "get_meeting", boom)
    safe = client.__class__(client.app, raise_server_exceptions=False)
    r = safe.get("/api/meetings/123456789", headers=H("u"))
    assert r.status_code == 500
    assert "SECRETPW" not in r.text and "postgresql" not in r.text and "Traceback" not in r.text


def test_tokens_and_secrets_never_reach_the_logs(client, caplog):
    caplog.set_level(logging.DEBUG)
    good = H("u")["Authorization"].split()[1]
    bad = make_token("u", key=_OTHER_KEY)
    client.get("/api/users/me", headers={"Authorization": f"Bearer {bad}"})
    client.get("/api/users/me", headers={"Authorization": f"Bearer {good}"})
    with client.websocket_connect("/ws/notifications") as ws:
        ws.send_json({"type": "auth", "token": bad})
        ws.receive_json()
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert good not in logged and bad not in logged and "Bearer " not in logged


# ---- token attacks ---------------------------------------------------------------------------------------


def _b64(obj) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def test_alg_none_token_is_rejected(client):
    claims = {"sub": "u", "iss": ISSUER, "exp": int(time.time()) + 300}
    forged = f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64(claims)}."
    assert client.get("/api/users/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_hs256_key_confusion_is_rejected(client):
    from cryptography.hazmat.primitives import serialization

    public_pem = _KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    now = int(time.time())
    # PyJWT refuses to sign HS256 with a PEM public key by default; build the token by hand.
    import hashlib
    import hmac

    head, body = _b64({"alg": "HS256", "typ": "JWT"}), _b64({"sub": "u", "iss": ISSUER, "exp": now + 300})
    sig = base64.urlsafe_b64encode(hmac.new(public_pem, f"{head}.{body}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    assert client.get("/api/users/me", headers={"Authorization": f"Bearer {head}.{body}.{sig}"}).status_code == 401


def test_tampered_payload_and_missing_claims_are_rejected(client):
    token = make_token("victim")
    head, _, sig = token.split(".")
    forged_body = _b64({"sub": "admin", "iss": ISSUER, "exp": int(time.time()) + 300})
    assert client.get("/api/users/me", headers={"Authorization": f"Bearer {head}.{forged_body}.{sig}"}).status_code == 401
    no_sub = jwt.encode({"iss": ISSUER, "exp": int(time.time()) + 300}, _KEY, algorithm="RS256", headers={"kid": "t"})
    assert client.get("/api/users/me", headers={"Authorization": f"Bearer {no_sub}"}).status_code == 401
    no_exp = jwt.encode({"sub": "u", "iss": ISSUER}, _KEY, algorithm="RS256", headers={"kid": "t"})
    assert client.get("/api/users/me", headers={"Authorization": f"Bearer {no_exp}"}).status_code == 401


def test_token_for_another_application_is_rejected_when_parties_are_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "clerk_authorized_parties", ["https://meetly.example"])
    foreign = jwt.encode(
        {"sub": "u", "iss": ISSUER, "exp": int(time.time()) + 300, "azp": "https://other-app.example"},
        _KEY, algorithm="RS256", headers={"kid": "t"},
    )
    assert client.get("/api/users/me", headers={"Authorization": f"Bearer {foreign}"}).status_code == 401
    ok = jwt.encode(
        {"sub": "u", "iss": ISSUER, "exp": int(time.time()) + 300, "azp": "https://meetly.example"},
        _KEY, algorithm="RS256", headers={"kid": "t"},
    )
    assert client.get("/api/users/me", headers={"Authorization": f"Bearer {ok}"}).status_code == 200


@pytest.mark.parametrize("header", ["", "Bearer", "Bearer ", "Basic abc", "bearer", "Token xyz"])
def test_malformed_authorization_headers(client, header):
    assert client.get("/api/users/me", headers={"Authorization": header}).status_code == 401


# ---- mass assignment and spoofing ----------------------------------------------------------------------------


def test_extra_fields_cannot_set_host_or_owner(client):
    host = uid(client, "host")
    other = uid(client, "other")
    r = client.post("/api/meetings", json={"title": "T", "host_id": other, "status": "ended", "id": 99}, headers=H("host"))
    assert r.status_code == 201
    body = r.json()
    assert body["host_id"] == host and body["status"] == "active" and body["id"] != 99


def test_participant_registration_ignores_a_claimed_user_and_is_idempotent(client):
    meeting = new_meeting(client)
    guest = uid(client, "guest")
    first = client.post(f"/api/meetings/{meeting}/participants", json={"display_name": "G", "user_id": 999, "is_host": True}, headers=H("guest"))
    second = client.post(f"/api/meetings/{meeting}/participants", json={"display_name": "G"}, headers=H("guest"))
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["user_id"] == guest and first.json()["is_host"] is False


# ---- concurrency --------------------------------------------------------------------------------------------------


def test_simultaneous_socket_joins_create_one_participant_row(client):
    meeting = new_meeting(client)
    uid(client, "guest")
    token = H("guest")["Authorization"].split()[1]
    barrier = threading.Barrier(4)
    results: list[str] = []

    def join():
        with client.websocket_connect(f"/ws/meetings/{meeting}") as ws:
            barrier.wait()
            ws.send_json({"type": "join", "meeting_id": meeting, "display_name": "G", "token": token})
            results.append(ws.receive_json()["type"])

    ts = [threading.Thread(target=join) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert results == ["joined"] * 4, results
    with client.Session() as db:
        assert db.scalar(select(func.count()).select_from(Participant).where(Participant.user_id == uid(client, "guest"))) == 1


def test_database_refuses_a_second_participant_row_for_the_same_person(client):
    from sqlalchemy.exc import IntegrityError

    meeting = new_meeting(client)
    guest = uid(client, "guest")
    from app.models import Meeting

    with client.Session() as db:
        m = db.scalars(select(Meeting).where(Meeting.meeting_id == meeting)).one()
        db.add(Participant(meeting_id=m.id, user_id=guest, display_name="A"))
        db.commit()
        db.add(Participant(meeting_id=m.id, user_id=guest, display_name="B"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        # guests without an account are not constrained
        db.add_all([Participant(meeting_id=m.id, user_id=None, display_name="x"), Participant(meeting_id=m.id, user_id=None, display_name="y")])
        db.commit()


# ---- ownership (IDOR) matrix --------------------------------------------------------------------------------------


def test_cross_user_access_is_denied_across_resources(client):
    meeting = new_meeting(client, "owner")
    uid(client, "intruder")
    assert client.delete(f"/api/meetings/{meeting}", headers=H("intruder")).status_code == 403
    assert client.get(f"/api/meetings/{meeting}/participants", headers=H("intruder")).status_code == 403
    assert client.get(f"/api/meetings/{meeting}/waiting-room", headers=H("intruder")).status_code == 403
    assert client.get(f"/api/meetings/{meeting}/invitations", headers=H("intruder")).status_code == 404
    assert client.post(f"/api/meetings/{meeting}/invitations", json={"user_ids": [1]}, headers=H("intruder")).status_code == 404
    other = uid(client, "owner")
    assert client.get(f"/api/schedules/upcoming", headers=H("intruder")).json() == []
    assert client.patch(f"/api/users/{other}/profile", json={"bio": "x"}, headers=H("intruder")).status_code == 405
    assert client.get(f"/api/meetings/{meeting}", headers=H("owner")).json()["status"] == "active"
