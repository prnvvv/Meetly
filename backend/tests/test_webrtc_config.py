import base64
import hashlib
import hmac

import pytest

from app.config import settings
from app.routers.webrtc import build_ice_config, turn_credentials
from app.security.ratelimit import limiter
from tests.test_auth import bearer
from tests.test_profiles import client  # noqa: F401  (fixture)
from tests.test_social import H, uid  # noqa: F401


@pytest.fixture(autouse=True)
def _reset():
    limiter.reset()
    yield


def test_requires_authentication(client):
    assert client.get("/api/webrtc/ice-servers").status_code == 401


def test_stun_only_when_turn_is_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "turn_urls", "")
    monkeypatch.setattr(settings, "turn_shared_secret", "")
    body = client.get("/api/webrtc/ice-servers", headers=H("u")).json()
    assert body["turn_enabled"] is False
    assert [s["urls"] for s in body["ice_servers"]] == [[settings.stun_server]]
    assert all(s["username"] is None and s["credential"] is None for s in body["ice_servers"])


def test_turn_credentials_are_short_lived_per_user_and_verifiable(client, monkeypatch):
    monkeypatch.setattr(settings, "turn_urls", "turn:turn.example.com:3478?transport=udp, turns:turn.example.com:5349?transport=tcp")
    monkeypatch.setattr(settings, "turn_shared_secret", "s3cr3t-shared")
    monkeypatch.setattr(settings, "turn_credential_ttl", 600)
    user = uid(client, "u")
    body = client.get("/api/webrtc/ice-servers", headers=H("u")).json()
    assert body["turn_enabled"] is True and body["ttl_seconds"] == 600
    turn = body["ice_servers"][1]
    assert turn["urls"] == ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"]
    expiry, who = turn["username"].split(":")
    assert who == str(user)
    import time

    assert 590 <= int(expiry) - time.time() <= 601  # expires in about ten minutes
    expected = base64.b64encode(hmac.new(b"s3cr3t-shared", turn["username"].encode(), hashlib.sha1).digest()).decode()
    assert turn["credential"] == expected  # exactly what coturn computes for use-auth-secret
    assert "s3cr3t-shared" not in str(body)  # the shared secret never leaves the server


def test_each_user_and_each_time_gets_different_credentials(monkeypatch):
    monkeypatch.setattr(settings, "turn_urls", "turn:t.example.com:3478")
    monkeypatch.setattr(settings, "turn_shared_secret", "k")
    a, b = build_ice_config(1, now=1000), build_ice_config(2, now=1000)
    later = build_ice_config(1, now=2000)
    creds = {a.ice_servers[1].credential, b.ice_servers[1].credential, later.ice_servers[1].credential}
    assert len(creds) == 3


def test_the_ttl_has_a_floor_and_the_secret_is_required_for_turn(monkeypatch):
    monkeypatch.setattr(settings, "turn_urls", "turn:t.example.com:3478")
    monkeypatch.setattr(settings, "turn_shared_secret", "")
    assert build_ice_config(1).turn_enabled is False  # urls alone are not enough
    assert turn_credentials("k", 1, ttl=10, now=0)[0].startswith("10:")


def test_rate_limited(client, monkeypatch):
    monkeypatch.setattr(settings, "turn_urls", "")
    codes = [client.get("/api/webrtc/ice-servers", headers=H("u")).status_code for _ in range(32)]
    assert codes[:30] == [200] * 30 and 429 in codes[30:]
