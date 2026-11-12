"""Profiles: creation, editing, privacy filtering, avatars and abuse limits.

Uses real RS256 test tokens for several independent identities (same approach
as test_auth.py) and an in-memory fake for Supabase Storage.
"""

from __future__ import annotations

import io
import os
import shutil
import tempfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("AUTH_MODE", "demo")

from app import auth  # noqa: E402
from app.config import settings  # noqa: E402
from app.database.database import Base  # noqa: E402
from app.database.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import UserProfile  # noqa: E402
from app.security.ratelimit import limiter  # noqa: E402
from app.services import storage  # noqa: E402
from tests.test_auth import ISSUER, _FakeJwks, bearer  # noqa: E402


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def upload(self, path, data, content_type):
        assert content_type == "image/webp"
        self.objects[path] = data

    def delete(self, paths):
        for p in paths:
            self.objects.pop(p, None)

    def sign_many(self, paths):
        return {p: f"https://signed.test/{p}?token=t" for p in paths if p in self.objects}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(settings, "auth_mode", "clerk")
    monkeypatch.setattr(settings, "clerk_issuer", ISSUER)
    monkeypatch.setattr(settings, "clerk_authorized_parties", [])
    monkeypatch.setattr(settings, "clerk_secret_key", "")
    monkeypatch.setattr(auth, "_jwks_client", lambda: _FakeJwks())
    fake = FakeStorage()
    storage.set_storage(fake)
    limiter.reset()

    tmp_dir = tempfile.mkdtemp(prefix="meetly_profile_test_")
    engine = create_engine(
        f"sqlite:///{os.path.join(tmp_dir, 'test.db')}",
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
    with TestClient(app) as c:
        c.fake_storage = fake  # type: ignore[attr-defined]
        c.Session = Session  # type: ignore[attr-defined]
        yield c
    engine.dispose()
    shutil.rmtree(tmp_dir, ignore_errors=True)


def me(client, sub="user_a"):
    r = client.get("/api/users/me/profile", headers=bearer(sub))
    assert r.status_code == 200, r.text
    return r.json()


def png_bytes(size=(200, 200), fmt="PNG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(buf, format=fmt)
    return buf.getvalue()


def put_avatar(client, data: bytes, sub="user_a", ctype="image/png"):
    return client.put(
        "/api/users/me/avatar", content=data, headers={**bearer(sub), "Content-Type": ctype}
    )


# --- creation -----------------------------------------------------------------


def test_requires_authentication(client):
    assert client.get("/api/users/me/profile").status_code == 401
    assert client.patch("/api/users/me/profile", json={"bio": "x"}).status_code == 401
    assert client.get("/api/users/1/profile").status_code == 401
    assert client.put("/api/users/me/avatar", content=b"x").status_code == 401


def test_profile_created_on_first_sign_in(client):
    profile = me(client)
    assert profile["is_self"] is True and profile["visibility"] == "public"
    assert profile["username"].startswith("user") or len(profile["username"]) >= 3
    assert profile["stats"] == {"meetings_hosted": 0, "meetings_attended": 0, "minutes_hosted": 0}
    # idempotent
    assert me(client)["user_id"] == profile["user_id"]


def test_two_users_get_distinct_profiles_and_usernames(client):
    a, b = me(client, "user_a"), me(client, "user_b")
    assert a["user_id"] != b["user_id"] and a["username"] != b["username"]


# --- editing and validation -----------------------------------------------------


def test_edit_profile(client):
    r = client.patch(
        "/api/users/me/profile",
        headers=bearer("user_a"),
        json={
            "display_name": "  Ada Lovelace ",
            "bio": "Maths & machines",
            "location": "London",
            "designation": "Analyst",
            "organization": "Analytical Engine",
            "website": "https://ada.example",
            "social_links": {"github": "https://github.com/ada", "twitter": None},
            "username": "Ada_L",
            "visibility": "friends",
            "show_meeting_stats": True,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_name"] == "Ada Lovelace" and body["username"] == "ada_l"
    assert body["social_links"] == {"github": "https://github.com/ada"}
    assert body["visibility"] == "friends" and body["show_meeting_stats"] is True


def test_clearing_optional_fields_with_null(client):
    h = bearer("user_a")
    client.patch("/api/users/me/profile", headers=h, json={"bio": "hi", "location": "X"})
    r = client.patch("/api/users/me/profile", headers=h, json={"bio": None})
    assert r.json()["bio"] is None and r.json()["location"] == "X"


def test_username_uniqueness_case_insensitive(client):
    client.patch("/api/users/me/profile", headers=bearer("user_a"), json={"username": "taken_name"})
    r = client.patch("/api/users/me/profile", headers=bearer("user_b"), json={"username": "TAKEN_Name"})
    assert r.status_code == 409
    avail = client.get("/api/users/username-available?username=Taken_Name", headers=bearer("user_b"))
    assert avail.json()["available"] is False
    own = client.get("/api/users/username-available?username=taken_name", headers=bearer("user_a"))
    assert own.json()["available"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "ab"},
        {"username": "1abc"},
        {"username": "has space"},
        {"username": "admin"},
        {"username": None},
        {"display_name": "   "},
        {"bio": "x" * 501},
        {"website": "javascript:alert(1)"},
        {"website": "ftp://x.example"},
        {"social_links": {"github": "http://insecure.example"}},
        {"social_links": {"myspace": "https://x.example"}},
        {"visibility": "everyone"},
        {"user_id": 99},
        {"avatar_path": "../../etc/passwd"},
        {"created_at": "2000-01-01T00:00:00Z"},
    ],
)
def test_invalid_or_forbidden_fields_rejected(client, payload):
    r = client.patch("/api/users/me/profile", headers=bearer("user_a"), json=payload)
    assert r.status_code == 422, (payload, r.text)


def test_sql_injection_is_inert(client):
    r = client.get(
        "/api/users/username-available",
        params={"username": "x'; DROP TABLE user_profiles;--"},
        headers=bearer("user_a"),
    )
    assert r.status_code == 200 and r.json()["available"] is False
    assert me(client)["user_id"]


def test_control_characters_stripped(client):
    r = client.patch(
        "/api/users/me/profile", headers=bearer("user_a"), json={"bio": "hi\x00there\x07"}
    )
    assert r.json()["bio"] == "hithere"


# --- privacy -------------------------------------------------------------------


def _set(client, sub, **fields):
    r = client.patch("/api/users/me/profile", headers=bearer(sub), json=fields)
    assert r.status_code == 200, r.text
    return r.json()


def test_public_profile_visible_to_others_without_private_data(client):
    a = _set(client, "user_a", bio="hello", location="Paris")
    me(client, "user_b")
    r = client.get(f"/api/users/{a['user_id']}/profile", headers=bearer("user_b"))
    assert r.status_code == 200
    body = r.json()
    assert body["bio"] == "hello" and body["limited"] is False and body["is_self"] is False
    # owner-only settings and stats are not exposed
    assert body["visibility"] is None and body["show_meeting_stats"] is None
    assert body["stats"] is None
    assert "email" not in r.text and "clerk" not in r.text.lower()


def test_stats_visible_only_when_owner_allows(client):
    a = _set(client, "user_a", show_meeting_stats=True)
    me(client, "user_b")
    r = client.get(f"/api/users/{a['user_id']}/profile", headers=bearer("user_b"))
    assert r.json()["stats"] is not None


def test_friends_only_profile_is_limited_for_strangers(client):
    a = _set(client, "user_a", visibility="friends", bio="secret bio", website="https://a.example")
    me(client, "user_b")
    r = client.get(f"/api/users/{a['user_id']}/profile", headers=bearer("user_b"))
    assert r.status_code == 200
    body = r.json()
    assert body["limited"] is True
    assert body["bio"] is None and body["website"] is None and body["stats"] is None
    assert body["avatar_url"] is None and body["username"] == a["username"]


def test_private_profile_hidden_from_others_but_not_owner(client):
    a = _set(client, "user_a", visibility="private", bio="mine")
    me(client, "user_b")
    assert client.get(f"/api/users/{a['user_id']}/profile", headers=bearer("user_b")).status_code == 404
    assert client.get(f"/api/users/{a['user_id']}/profile", headers=bearer("user_a")).json()["bio"] == "mine"


def test_unknown_user_is_404_and_indistinguishable_from_private(client):
    me(client, "user_b")
    assert client.get("/api/users/99999/profile", headers=bearer("user_b")).status_code == 404


def test_cannot_modify_another_users_profile_by_id(client):
    a = me(client, "user_a")
    me(client, "user_b")
    # There is no id-addressed write endpoint; the "me" endpoints only touch the caller.
    _set(client, "user_b", bio="b's bio")
    assert client.get(f"/api/users/{a['user_id']}/profile", headers=bearer("user_a")).json()["bio"] is None
    assert client.patch(f"/api/users/{a['user_id']}/profile", headers=bearer("user_b"), json={"bio": "x"}).status_code == 405


# --- avatars ---------------------------------------------------------------------


def test_avatar_upload_reencodes_to_square_webp_and_signs_url(client):
    r = put_avatar(client, png_bytes((300, 150)))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["avatar_url"].startswith("https://signed.test/")
    (path, data), = client.fake_storage.objects.items()
    assert path.endswith(".webp") and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    assert Image.open(io.BytesIO(data)).size == (512, 512)


def test_replacing_avatar_deletes_old_object(client):
    put_avatar(client, png_bytes())
    first = next(iter(client.fake_storage.objects))
    put_avatar(client, png_bytes((120, 120), "JPEG"), ctype="image/jpeg")
    assert first not in client.fake_storage.objects and len(client.fake_storage.objects) == 1


def test_delete_avatar(client):
    put_avatar(client, png_bytes())
    r = client.delete("/api/users/me/avatar", headers=bearer("user_a"))
    assert r.status_code == 200 and r.json()["avatar_url"] is None
    assert client.fake_storage.objects == {}


@pytest.mark.parametrize(
    "data,ctype",
    [
        (b"", "image/png"),
        (b"not an image at all", "image/png"),
        (b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml"),
        (b"GIF89a" + b"\x00" * 50, "image/gif"),
        (b"\x89PNG\r\n\x1a\n" + b"junk" * 20, "image/png"),
        (b"MZ\x90\x00" + b"\x00" * 100, "image/png"),
    ],
)
def test_non_images_rejected_regardless_of_declared_type(client, data, ctype):
    assert put_avatar(client, data, ctype=ctype).status_code == 422
    assert client.fake_storage.objects == {}


def test_gif_image_rejected_even_when_valid(client):
    assert put_avatar(client, png_bytes((100, 100), "GIF"), ctype="image/png").status_code == 422


def test_tiny_image_rejected(client):
    assert put_avatar(client, png_bytes((10, 10))).status_code == 422


def test_oversized_upload_rejected_413(client):
    assert put_avatar(client, b"\x00" * (2 * 1024 * 1024 + 1)).status_code == 413


def test_image_metadata_is_stripped(client):
    buf = io.BytesIO()
    img = Image.new("RGB", (200, 200), (1, 2, 3))
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    img.save(buf, format="JPEG", exif=exif)
    assert put_avatar(client, buf.getvalue(), ctype="image/jpeg").status_code == 200
    (stored,) = client.fake_storage.objects.values()
    assert b"SecretCameraMaker" not in stored


def test_friends_only_avatar_not_signed_for_strangers(client):
    put_avatar(client, png_bytes())
    a = _set(client, "user_a", visibility="friends")
    me(client, "user_b")
    r = client.get(f"/api/users/{a['user_id']}/profile", headers=bearer("user_b"))
    assert r.json()["avatar_url"] is None
    mine = client.get("/api/users/me/profile", headers=bearer("user_a")).json()
    assert mine["avatar_url"] is not None


def test_public_avatar_visible_to_others(client):
    put_avatar(client, png_bytes())
    a = me(client, "user_a")
    me(client, "user_b")
    r = client.get(f"/api/users/{a['user_id']}/profile", headers=bearer("user_b"))
    assert r.json()["avatar_url"].startswith("https://signed.test/")


def test_avatar_rate_limited(client):
    codes = [put_avatar(client, b"junk").status_code for _ in range(12)]
    assert codes[:10] == [422] * 10 and codes[10:] == [429, 429]


def test_avatar_storage_outage_returns_503_and_keeps_profile(client):
    class Down(FakeStorage):
        def upload(self, *a, **k):
            raise storage.StorageUnavailable("down")

    storage.set_storage(Down())
    assert put_avatar(client, png_bytes()).status_code == 503
    assert me(client)["avatar_url"] is None


def test_profile_row_stores_object_key_not_url(client):
    put_avatar(client, png_bytes())
    with client.Session() as db:
        path = db.scalars(select(UserProfile.avatar_path)).first()
    assert path and not path.startswith("http")
