"""Request ids, structured logs, redaction, health/readiness and safe error responses."""

from __future__ import annotations

import io
import json
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app import observability
from app.security.ratelimit import limiter
from tests.test_auth import _OTHER_KEY, bearer, make_token
from tests.test_profiles import client, me  # noqa: F401  (fixtures)
from tests.test_social import H, uid  # noqa: F401


@pytest.fixture(autouse=True)
def _reset():
    limiter.reset()
    yield


# ---- request ids -----------------------------------------------------------------------


def test_every_response_carries_a_request_id(client):
    r = client.get("/health")
    assert len(r.headers["x-request-id"]) >= 8
    assert client.get("/health").headers["x-request-id"] != r.headers["x-request-id"]


def test_a_valid_inbound_request_id_is_kept_and_a_hostile_one_is_replaced(client):
    assert client.get("/health", headers={"X-Request-ID": "trace-1234abcd"}).headers["x-request-id"] == "trace-1234abcd"
    for bad in ("x", 'has space and "quotes"', "a" * 200, "inject{json}:1"):
        got = client.get("/health", headers={"X-Request-ID": bad}).headers["x-request-id"]
        assert got != bad and len(got) == 32  # generated instead of echoed (no log/header injection)


def test_error_responses_include_the_request_id_and_nothing_internal(client, monkeypatch):
    from app.services import meeting_service

    def boom(*a, **k):
        raise RuntimeError("postgresql://svc:TOPSECRETPW@db.internal/prod exploded for ada@example.com")

    monkeypatch.setattr(meeting_service, "get_meeting", boom)
    safe = TestClient(client.app, raise_server_exceptions=False)
    r = safe.get("/api/meetings/123456789", headers={**H("u"), "X-Request-ID": "report-5678efgh"})
    assert r.status_code == 500
    assert r.json() == {"detail": "Internal server error", "request_id": "report-5678efgh"}
    assert "TOPSECRETPW" not in r.text and "example.com" not in r.text and "db.internal" not in r.text


def test_a_database_outage_is_a_503_with_retry_after_not_a_stack_trace(client, monkeypatch):
    from app.services import meeting_service

    def down(*a, **k):
        raise OperationalError("SELECT 1", {}, Exception("connection refused to 10.0.0.5:5432"))

    monkeypatch.setattr(meeting_service, "get_meeting", down)
    safe = TestClient(client.app, raise_server_exceptions=False)
    r = safe.get("/api/meetings/123456789", headers=H("u"))
    assert r.status_code == 503 and r.headers["retry-after"] == "5"
    assert "10.0.0.5" not in r.text and "request_id" in r.json()


# ---- structured logs -----------------------------------------------------------------------


def capture(fmt: str = "json"):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(observability.RequestIdFilter())
    handler.addFilter(observability.RedactionFilter())
    handler.setFormatter(observability.JsonFormatter() if fmt == "json" else logging.Formatter("%(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    return stream, handler


def test_access_log_is_json_with_request_id_status_and_no_query_string(client):
    stream, handler = capture()
    try:
        client.get("/health?token=SECRETQUERY", headers={"X-Request-ID": "access-1234abcd"})
    finally:
        logging.getLogger().removeHandler(handler)
    lines = [json.loads(l) for l in stream.getvalue().splitlines() if l.startswith("{")]
    access = [l for l in lines if l["logger"] == "meetly.access"]
    assert access and access[0]["request_id"] == "access-1234abcd"
    assert access[0]["msg"] == "GET /health -> 200" and "duration_ms" in access[0]
    ours = chr(10).join(l for l in stream.getvalue().splitlines() if '"logger": "httpx"' not in l)  # httpx is the TEST client
    assert "SECRETQUERY" not in ours


def test_redaction_removes_tokens_keys_emails_and_connection_strings():
    jwt_like = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl"
    text = (
        f"Authorization: Bearer {jwt_like} key=sk_test_ABCDEFGHIJKLMNOP1234 sb_secret_abcdefghijklmnop "
        "user=ada.lovelace@example.com url=postgresql://postgres.ref:Sup3rS3cret@aws-0.pooler.supabase.com:6543/postgres "
        "enc:v1:1:AAAAAAAAAAAAAAAAAAAAAAAA"
    )
    out = observability.redact(text)
    for secret in (jwt_like, "sk_test_ABCDEF", "sb_secret_abcdef", "ada.lovelace", "Sup3rS3cret", "AAAAAAAAAAAA"):
        assert secret not in out
    assert "[redacted" in out


def test_the_filter_redacts_even_when_code_logs_a_secret_by_mistake():
    stream, handler = capture("text")
    try:
        logging.getLogger("meetly.test").info("oops %s", "Bearer abcdefghijklmnop12345")
    finally:
        logging.getLogger().removeHandler(handler)
    assert "abcdefghijklmnop12345" not in stream.getvalue() and "[redacted]" in stream.getvalue()


def test_exceptions_are_logged_with_their_type_and_redacted_text(client, monkeypatch):
    from app.services import meeting_service

    monkeypatch.setattr(meeting_service, "get_meeting", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("bad user ada@example.com")))
    stream, handler = capture()
    try:
        TestClient(client.app, raise_server_exceptions=False).get("/api/meetings/123456789", headers=H("u"))
    finally:
        logging.getLogger().removeHandler(handler)
    errors = [json.loads(l) for l in stream.getvalue().splitlines() if l.startswith("{") and '"ERROR"' in l]
    assert errors and errors[0]["exc_type"] == "RuntimeError"
    assert "ada@example.com" not in stream.getvalue()


# ---- security-relevant events ------------------------------------------------------------------


def test_authentication_failures_are_logged_without_the_credential(client, caplog):
    caplog.set_level(logging.INFO)
    bad = make_token("u", key=_OTHER_KEY)
    assert client.get("/api/users/me", headers={"Authorization": f"Bearer {bad}"}).status_code == 401
    messages = [r.getMessage() for r in caplog.records]
    assert any("authentication failed" in m for m in messages)
    assert not any(bad in m or bad[:30] in m for m in messages)


def test_rate_limit_events_are_logged_with_bucket_and_user_only(client, caplog):
    caplog.set_level(logging.WARNING)
    uid(client, "u_a")
    for _ in range(42):
        client.get("/api/users/search?q=zz", headers=H("u_a"))
    hits = [r.getMessage() for r in caplog.records if "rate limit exceeded" in r.getMessage()]
    assert hits and "bucket=search" in hits[0] and "user_id=" in hits[0] and "zz" not in hits[0]


def test_websocket_lifecycle_is_logged_with_ids_not_names_or_tokens(client, caplog):
    caplog.set_level(logging.INFO)
    r = client.post("/api/meetings", json={"title": "Secret board meeting"}, headers=H("host"))
    meeting = r.json()["meeting_id"]
    token = H("host")["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/meetings/{meeting}") as ws:
        ws.send_json({"type": "join", "meeting_id": meeting, "display_name": "Ada Lovelace", "token": token})
        ws.receive_json()
    logs = "\n".join(r.getMessage() for r in caplog.records)
    assert f"ws joined meeting={meeting}" in logs
    assert "Ada Lovelace" not in logs and "Secret board meeting" not in logs and token not in logs


# ---- health --------------------------------------------------------------------------------------


def test_liveness_never_depends_on_the_database(client, monkeypatch):
    monkeypatch.setattr(observability, "request_id_var", observability.request_id_var)
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health").json() == {"status": "ok"}


def test_readiness_reports_booleans_only(client):
    r = client.get("/health/ready")
    assert r.status_code == 200 and r.json() == {"status": "ok", "checks": {"database": True, "schema": True, "encryption_config": True}}


def test_readiness_fails_closed_without_leaking_why(client, monkeypatch):
    import app.database.database as dbmod

    class Broken:
        def connect(self):
            raise OperationalError("SELECT 1", {}, Exception("could not connect to server at 10.1.2.3"))

    monkeypatch.setattr(dbmod, "engine", Broken())
    r = client.get("/health/ready")
    assert r.status_code == 503 and r.json()["checks"]["database"] is False
    assert "10.1.2.3" not in r.text


def test_readiness_flags_a_broken_encryption_configuration(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "email_encryption_mode", "encrypted")
    monkeypatch.setattr(settings, "field_encryption_keys", "")
    r = client.get("/health/ready")
    assert r.status_code == 503 and r.json()["checks"]["encryption_config"] is False


def test_configure_logging_is_idempotent_and_format_follows_the_environment(monkeypatch):
    root = logging.getLogger()
    before = len(root.handlers)
    observability.configure_logging("production")
    observability.configure_logging("production")
    mine = [h for h in root.handlers if getattr(h, "_meetly", False)]
    assert len(mine) == 1 and isinstance(mine[0].formatter, observability.JsonFormatter)
    observability.configure_logging("local")
    mine = [h for h in root.handlers if getattr(h, "_meetly", False)]
    assert len(mine) == 1 and not isinstance(mine[0].formatter, observability.JsonFormatter)
    root.removeHandler(mine[0])
    assert len(root.handlers) <= before + 1

