"""Authentication, authorization, multi-user isolation and persistence.

Tokens are real RS256 JWTs signed with a key generated for the test run; the
JWKS lookup is replaced by that key's public half, so signature, issuer and
expiry checks run for real. No Clerk network access is needed.

    pytest tests/test_auth.py -v
"""

from __future__ import annotations

import os
import shutil
import tempfile
import threading
import time
from datetime import timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("AUTH_MODE", "demo")

from app import auth  # noqa: E402
from app.config import settings  # noqa: E402
from app.database.database import Base  # noqa: E402
from app.database.migrations import apply_migrations  # noqa: E402
from app.database.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Meeting, Participant, User  # noqa: E402
from app.utils.datetime_utils import utc_now  # noqa: E402
from app.websocket.manager import get_manager  # noqa: E402

ISSUER = "https://clerk.test.example"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeJwks:
    def get_signing_key_from_jwt(self, _token: str):
        class _Key:
            key = _KEY.public_key()

        return _Key()


def make_token(sub: str, *, key=_KEY, issuer: str = ISSUER, expires_in: int = 300) -> str:
    now = int(time.time())
    claims = {"sub": sub, "iss": issuer, "iat": now, "exp": now + expires_in}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test"})


def bearer(sub: str, **kwargs) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub, **kwargs)}"}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(settings, "auth_mode", "clerk")
    monkeypatch.setattr(settings, "clerk_issuer", ISSUER)
    monkeypatch.setattr(settings, "clerk_authorized_parties", [])
    monkeypatch.setattr(settings, "clerk_secret_key", "")
    monkeypatch.setattr(auth, "_jwks_client", lambda: _FakeJwks())

    tmp_dir = tempfile.mkdtemp(prefix="meetly_auth_test_")
    db_path = os.path.join(tmp_dir, "test.db")
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False, "timeout": 15},
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    app = create_app()

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    get_manager()._meetings.clear()
    get_manager()._screen_sharing.clear()
    with TestClient(app) as test_client:
        test_client.testing_session = Session  # type: ignore[attr-defined]
        test_client.engine = engine  # type: ignore[attr-defined]
        test_client.db_path = db_path  # type: ignore[attr-defined]
        yield test_client
    engine.dispose()
    shutil.rmtree(tmp_dir, ignore_errors=True)


def _create_meeting(client, sub: str, **payload):
    response = client.post("/api/meetings", json={"title": "Sync", **payload}, headers=bearer(sub))
    assert response.status_code == 201, response.text
    return response.json()


# --- authentication ----------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/users/me"),
        ("post", "/api/meetings"),
        ("get", "/api/schedules/upcoming"),
        ("get", "/api/meetings/123456789"),
        ("get", "/api/meetings/123456789/participants"),
    ],
)
def test_protected_endpoints_reject_anonymous_requests(client, method, path):
    kwargs = {"json": {"title": "x"}} if method == "post" else {}
    assert getattr(client, method)(path, **kwargs).status_code == 401


def test_health_stays_public(client):
    assert client.get("/health").status_code == 200


def test_rejects_forged_expired_and_foreign_issuer_tokens(client):
    # The fake JWKS always verifies with _KEY, so a token signed by another key fails.
    assert client.get("/api/users/me", headers=bearer("user_a", key=_OTHER_KEY)).status_code == 401
    assert client.get("/api/users/me", headers=bearer("user_a", expires_in=-120)).status_code == 401
    assert (
        client.get("/api/users/me", headers=bearer("user_a", issuer="https://evil.example")).status_code
        == 401
    )
    assert client.get("/api/users/me", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_each_token_maps_to_its_own_user_and_is_created_once(client):
    a1 = client.get("/api/users/me", headers=bearer("user_a")).json()
    a2 = client.get("/api/users/me", headers=bearer("user_a")).json()
    b = client.get("/api/users/me", headers=bearer("user_b")).json()
    assert a1["id"] == a2["id"] != b["id"]
    assert "password" not in a1 and "clerk_id" not in a1
    with client.testing_session() as db:
        assert db.query(User).filter(User.clerk_id == "user_a").count() == 1


def test_a_client_cannot_choose_the_host_by_sending_a_user_id(client):
    meeting = _create_meeting(client, "user_a", host_id=999)  # extra field is ignored
    me = client.get("/api/users/me", headers=bearer("user_a")).json()
    assert meeting["host_id"] == me["id"]


# --- authorization / isolation -----------------------------------------------


def test_only_the_host_can_end_a_meeting(client):
    meeting = _create_meeting(client, "user_a")
    other = client.delete(f"/api/meetings/{meeting['meeting_id']}", headers=bearer("user_b"))
    assert other.status_code == 403
    assert client.delete(f"/api/meetings/{meeting['meeting_id']}", headers=bearer("user_a")).status_code == 200


def test_only_the_host_can_edit_a_scheduled_meeting(client):
    start = (utc_now() + timedelta(days=2)).isoformat()
    created = client.post(
        "/api/schedules",
        json={"title": "Plan", "start_time": start, "duration": 30},
        headers=bearer("user_a"),
    ).json()
    url = f"/api/schedules/{created['meeting_id']}"
    assert client.patch(url, json={"title": "Hijacked"}, headers=bearer("user_b")).status_code == 403
    assert client.patch(url, json={"title": "Renamed"}, headers=bearer("user_a")).json()["title"] == "Renamed"


def test_schedule_lists_only_show_the_callers_meetings(client):
    start = (utc_now() + timedelta(days=2)).isoformat()
    for sub, title in (("user_a", "A's"), ("user_b", "B's")):
        client.post(
            "/api/schedules",
            json={"title": title, "start_time": start, "duration": 30},
            headers=bearer(sub),
        )
    a = [m["title"] for m in client.get("/api/schedules/upcoming", headers=bearer("user_a")).json()]
    b = [m["title"] for m in client.get("/api/schedules/upcoming", headers=bearer("user_b")).json()]
    assert a == ["A's"] and b == ["B's"]


def test_participant_list_is_limited_to_the_host_and_participants(client):
    meeting = _create_meeting(client, "user_a")
    url = f"/api/meetings/{meeting['meeting_id']}/participants"
    assert client.get(url, headers=bearer("user_a")).status_code == 200
    assert client.get(url, headers=bearer("user_stranger")).status_code == 403
    joined = client.post(url, json={"display_name": "Bea"}, headers=bearer("user_b"))
    assert joined.status_code == 201
    assert client.get(url, headers=bearer("user_b")).status_code == 200


def test_participant_rows_are_bound_to_the_token_and_host_role_is_server_side(client):
    meeting = _create_meeting(client, "user_a")
    url = f"/api/meetings/{meeting['meeting_id']}/participants"
    row = client.post(url, json={"display_name": "Bea", "is_host": True}, headers=bearer("user_b")).json()
    assert row["is_host"] is False
    # Another user cannot remove Bea's row; Bea and the host can.
    delete = f"/api/participants/{row['id']}"
    assert client.delete(delete, headers=bearer("user_c")).status_code == 403
    assert client.delete(delete, headers=bearer("user_a")).status_code == 204


def test_meeting_password_still_blocks_join_for_authenticated_users(client):
    meeting = _create_meeting(client, "user_a", password="secret123")
    join = f"/api/meetings/{meeting['meeting_id']}/join"
    assert client.post(join, json={"display_name": "B"}, headers=bearer("user_b")).status_code == 403
    wrong = client.post(join, json={"display_name": "B", "password": "wrong"}, headers=bearer("user_b"))
    assert wrong.status_code == 403
    ok = client.post(join, json={"display_name": "B", "password": "secret123"}, headers=bearer("user_b"))
    assert ok.status_code == 200 and "password_hash" not in ok.json()


# --- profile and settings ----------------------------------------------------


def test_profile_and_device_preferences_persist_per_user(client):
    patched = client.patch(
        "/api/users/me",
        json={"name": "Ada", "preferences": {"camera_id": "cam-1"}},
        headers=bearer("user_a"),
    )
    assert patched.status_code == 200
    me = client.get("/api/users/me", headers=bearer("user_a")).json()
    assert me["name"] == "Ada" and me["preferences"]["camera_id"] == "cam-1"
    other = client.get("/api/users/me", headers=bearer("user_b")).json()
    assert other["name"] != "Ada" and other["preferences"]["camera_id"] is None
    assert client.patch("/api/users/me", json={"role": "admin"}, headers=bearer("user_a")).status_code == 422


def test_meeting_settings_are_saved_and_unknown_keys_rejected(client):
    meeting = _create_meeting(client, "user_a", settings={"lockMeeting": True, "allowChat": False})
    fetched = client.get(f"/api/meetings/{meeting['meeting_id']}", headers=bearer("user_a")).json()
    assert fetched["settings"] == {"lockMeeting": True, "allowChat": False}
    bad = client.post(
        "/api/meetings", json={"title": "x", "settings": {"superAdmin": True}}, headers=bearer("user_a")
    )
    assert bad.status_code == 422


# --- WebSocket ---------------------------------------------------------------


def _ws_join(client, meeting_id: str, name: str, token: str | None, participant_id: int | None = None):
    socket = client.websocket_connect(f"/ws/meetings/{meeting_id}")
    ws = socket.__enter__()
    payload = {"type": "join", "meeting_id": meeting_id, "display_name": name}
    if token is not None:
        payload["token"] = token
    if participant_id is not None:
        payload["participant_id"] = participant_id
    ws.send_json(payload)
    return socket, ws, ws.receive_json()


def test_websocket_requires_a_valid_token(client):
    meeting = _create_meeting(client, "user_a")
    for token in (None, "garbage", make_token("user_a", key=_OTHER_KEY)):
        socket, _ws, reply = _ws_join(client, meeting["meeting_id"], "X", token)
        assert reply["type"] == "error" and reply["code"] == "UNAUTHORIZED_ACTION"
        socket.__exit__(None, None, None)


def test_host_is_the_authenticated_host_not_the_first_to_join(client):
    meeting = _create_meeting(client, "user_a")
    mid = meeting["meeting_id"]
    s_b, _ws_b, reply_b = _ws_join(client, mid, "Bea", make_token("user_b"))
    s_a, _ws_a, reply_a = _ws_join(client, mid, "Ann", make_token("user_a"))
    try:
        assert reply_b["type"] != "error" and reply_a["type"] != "error"
        with client.testing_session() as db:
            rows = {p.display_name: p for p in db.query(Participant).all()}
            assert rows["Ann"].is_host is True
            assert rows["Bea"].is_host is False
    finally:
        s_a.__exit__(None, None, None)
        s_b.__exit__(None, None, None)


def test_rejoining_reuses_the_same_participant_row(client):
    meeting = _create_meeting(client, "user_a")
    mid = meeting["meeting_id"]
    for _ in range(3):
        socket, _ws, reply = _ws_join(client, mid, "Bea", make_token("user_b"))
        assert reply["type"] != "error"
        socket.__exit__(None, None, None)
    with client.testing_session() as db:
        assert db.query(Participant).count() == 1


def test_a_client_cannot_claim_another_users_participant_row(client):
    meeting = _create_meeting(client, "user_a")
    mid = meeting["meeting_id"]
    s_b, _ws_b, _ = _ws_join(client, mid, "Bea", make_token("user_b"))
    try:
        with client.testing_session() as db:
            bea_id = db.query(Participant).one().id
        s_c, _ws_c, reply = _ws_join(client, mid, "Mallory", make_token("user_c"), participant_id=bea_id)
        try:
            assert reply["type"] != "error"
            with client.testing_session() as db:
                mallory = db.query(Participant).filter(Participant.display_name == "Mallory").one()
                assert mallory.id != bea_id and mallory.is_host is False
        finally:
            s_c.__exit__(None, None, None)
    finally:
        s_b.__exit__(None, None, None)


def test_locked_meeting_refuses_new_joiners_but_admits_the_host(client):
    meeting = _create_meeting(client, "user_a", settings={"lockMeeting": True})
    mid = meeting["meeting_id"]
    socket, _ws, reply = _ws_join(client, mid, "Bea", make_token("user_b"))
    assert reply["type"] == "error"
    socket.__exit__(None, None, None)
    host_socket, _ws, host_reply = _ws_join(client, mid, "Ann", make_token("user_a"))
    assert host_reply["type"] != "error"
    host_socket.__exit__(None, None, None)


def test_two_meetings_do_not_share_participants(client):
    m1 = _create_meeting(client, "user_a")
    m2 = _create_meeting(client, "user_b")
    s1, _w1, _ = _ws_join(client, m1["meeting_id"], "Ann", make_token("user_a"))
    s2, _w2, _ = _ws_join(client, m2["meeting_id"], "Bea", make_token("user_b"))
    try:
        listed = client.get(f"/api/meetings/{m1['meeting_id']}/participants", headers=bearer("user_a")).json()
        assert [p["display_name"] for p in listed] == ["Ann"]
    finally:
        s1.__exit__(None, None, None)
        s2.__exit__(None, None, None)


# --- concurrency and persistence ---------------------------------------------


def test_concurrent_meeting_creation_by_many_users_is_consistent(client):
    users = [f"user_{i}" for i in range(16)]
    results: dict[str, dict] = {}
    errors: list[str] = []
    app = client.app

    def worker(sub: str) -> None:
        try:
            with TestClient(app) as c:
                response = c.post("/api/meetings", json={"title": f"Room {sub}"}, headers=bearer(sub))
                if response.status_code != 201:
                    errors.append(f"{sub}: {response.status_code} {response.text}")
                else:
                    results[sub] = response.json()
        except Exception as exc:  # pragma: no cover - surfaced through the assertion
            errors.append(f"{sub}: {exc!r}")

    threads = [threading.Thread(target=worker, args=(u,)) for u in users]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    assert len({m["meeting_id"] for m in results.values()}) == len(users)
    assert len({m["host_id"] for m in results.values()}) == len(users)
    with client.testing_session() as db:
        assert db.query(User).filter(User.clerk_id.is_not(None)).count() == len(users)
        for sub, meeting in results.items():
            assert db.get(User, meeting["host_id"]).clerk_id == sub


def test_concurrent_first_requests_for_one_user_create_one_row(client):
    app = client.app
    codes: list[int] = []

    def worker() -> None:
        with TestClient(app) as c:
            codes.append(c.get("/api/users/me", headers=bearer("user_race")).status_code)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert codes == [200] * 8
    with client.testing_session() as db:
        assert db.query(User).filter(User.clerk_id == "user_race").count() == 1


def test_data_survives_an_engine_restart(client):
    meeting = _create_meeting(client, "user_a", settings={"lockMeeting": True})
    client.engine.dispose()  # drop every connection, like a process restart
    restarted = create_engine(f"sqlite:///{client.db_path}")
    with sessionmaker(bind=restarted)() as db:
        row = db.execute(select(Meeting).where(Meeting.meeting_id == meeting["meeting_id"])).scalar_one()
        assert row.title == "Sync" and '"lockMeeting": true' in row.settings
    restarted.dispose()


# --- migrations --------------------------------------------------------------


def test_additive_migration_upgrades_an_old_database_without_touching_rows(tmp_path):
    path = tmp_path / "old.db"
    old = create_engine(f"sqlite:///{path}")
    with old.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(100), "
                "email VARCHAR(255) UNIQUE, created_at DATETIME)"
            )
        )
        conn.execute(text("CREATE TABLE meetings (id INTEGER PRIMARY KEY, title VARCHAR(255))"))
        conn.execute(text("INSERT INTO users (id, name, email) VALUES (1, 'Demo User', 'demo@example.com')"))
        conn.execute(text("INSERT INTO meetings (id, title) VALUES (1, 'Existing')"))

    apply_migrations(old)
    apply_migrations(old)  # idempotent

    columns = {c["name"] for c in inspect(old).get_columns("users")}
    assert {"clerk_id", "last_login_at", "preferences"} <= columns
    assert {"settings", "waiting_room_enabled", "admission_mode"} <= {c["name"] for c in inspect(old).get_columns("meetings")}
    assert {"email_ciphertext", "email_key_version", "email_blind_index", "email_bidx_version"} <= columns
    with old.connect() as conn:
        assert conn.execute(text("SELECT name FROM users WHERE id = 1")).scalar() == "Demo User"
        assert conn.execute(text("SELECT title FROM meetings WHERE id = 1")).scalar() == "Existing"
        # existing meetings keep today's behaviour: the waiting room is OFF
        assert conn.execute(text("SELECT waiting_room_enabled, admission_mode FROM meetings WHERE id = 1")).one() == (0, "host_approval")
    old.dispose()


def test_start_up_upgrades_a_pre_alembic_sqlite_database_so_the_current_code_runs_on_it(tmp_path):
    """Production is a SQLite file created by an older release: init-style upgrade must make it usable."""
    from app.models import Meeting, MeetingStatus, User

    path = tmp_path / "legacy.db"
    legacy = create_engine(f"sqlite:///{path}")
    with legacy.begin() as conn:  # the schema as it was before waiting rooms, profiles and encryption
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, created_at DATETIME NOT NULL, clerk_id VARCHAR(255), last_login_at DATETIME, preferences TEXT)"))
        conn.execute(text("CREATE TABLE meetings (id INTEGER PRIMARY KEY, meeting_id VARCHAR(32) NOT NULL UNIQUE, host_id INTEGER NOT NULL, title VARCHAR(255) NOT NULL, description TEXT, start_time DATETIME NOT NULL, end_time DATETIME, duration INTEGER, status VARCHAR(16) NOT NULL, meeting_link VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255), settings TEXT, created_at DATETIME NOT NULL)"))
        conn.execute(text("CREATE TABLE participants (id INTEGER PRIMARY KEY, user_id INTEGER, meeting_id INTEGER NOT NULL, display_name VARCHAR(100) NOT NULL, is_host BOOLEAN NOT NULL DEFAULT 0, is_muted BOOLEAN NOT NULL DEFAULT 1, is_video_on BOOLEAN NOT NULL DEFAULT 0, screen_share BOOLEAN NOT NULL DEFAULT 0, joined_at DATETIME, left_at DATETIME)"))
        conn.execute(text("INSERT INTO users (id, name, email, created_at, clerk_id) VALUES (7, 'Real User', 'real@example.com', '2026-01-01 00:00:00', 'user_real')"))
        conn.execute(text("INSERT INTO meetings (id, meeting_id, host_id, title, start_time, status, meeting_link, settings, created_at) VALUES (3, '555000111', 7, 'Old meeting', '2026-01-01 10:00:00', 'active', 'https://x/555000111', '{\"waitingRoom\": true}', '2026-01-01 09:00:00')"))
        conn.execute(text("INSERT INTO participants (id, user_id, meeting_id, display_name) VALUES (1, 7, 3, 'Real User'), (2, 7, 3, 'Real User (second tab)')"))

    Base.metadata.create_all(legacy)  # what init_db does first: creates only the missing tables
    apply_migrations(legacy)  # then adds the missing columns and indexes
    apply_migrations(legacy)

    with sessionmaker(bind=legacy)() as db:  # the current ORM models must work against the upgraded file
        meeting = db.execute(select(Meeting)).scalar_one()
        assert meeting.title == "Old meeting" and meeting.status is MeetingStatus.ACTIVE
        assert meeting.waiting_room_enabled is False and meeting.admission_mode == "host_approval"
        assert '"waitingRoom": true' in meeting.settings  # the legacy flag is preserved but NOT enforced
        user = db.execute(select(User)).scalar_one()
        assert user.email == "real@example.com" and user.email_ciphertext is None
    with legacy.connect() as conn:
        tables = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
        assert {"user_profiles", "friend_requests", "friendships", "user_blocks", "notifications",
                "meeting_invitations", "waiting_room_entries"} <= tables
        indexes = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='index'"))}
        assert "uq_users_email_blind_index" in indexes
        # the duplicate participant rows that already exist block the new unique index; no row was touched
        assert "uq_participants_meeting_user" not in indexes
        assert conn.execute(text("SELECT count(*) FROM participants")).scalar() == 2
    legacy.dispose()
