"""ICE server configuration for WebRTC clients (STUN always, TURN when configured).

TURN credentials follow coturn's ``use-auth-secret`` scheme: a username of ``<expiry>:<user id>``
and a password of ``base64(HMAC-SHA1(shared_secret, username))``. They stop working at the expiry
time, so nothing long-lived is ever handed to a browser, and the shared secret never leaves the
server. Without ``TURN_URLS`` and ``TURN_SHARED_SECRET`` only STUN is returned (the status quo).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import get_current_user
from app.config import settings
from app.models.user import User
from app.security.ratelimit import rate_limit

router = APIRouter(prefix="/api/webrtc", tags=["webrtc"])

DEFAULT_TTL_SECONDS = 3600


class IceServer(BaseModel):
    urls: list[str]
    username: str | None = None
    credential: str | None = None


class IceConfig(BaseModel):
    ice_servers: list[IceServer]
    ttl_seconds: int
    turn_enabled: bool


def turn_credentials(secret: str, user_id: int, ttl: int = DEFAULT_TTL_SECONDS, now: float | None = None) -> tuple[str, str]:
    expiry = int((time.time() if now is None else now) + ttl)
    username = f"{expiry}:{user_id}"
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    return username, base64.b64encode(digest).decode()


def build_ice_config(user_id: int, now: float | None = None) -> IceConfig:
    servers = [IceServer(urls=[settings.stun_server])]
    turn_urls = [u.strip() for u in settings.turn_urls.split(",") if u.strip()]
    enabled = bool(turn_urls and settings.turn_shared_secret)
    if enabled:
        username, credential = turn_credentials(settings.turn_shared_secret, user_id, settings.turn_credential_ttl, now)
        servers.append(IceServer(urls=turn_urls, username=username, credential=credential))
    return IceConfig(ice_servers=servers, ttl_seconds=settings.turn_credential_ttl, turn_enabled=enabled)


@router.get("/ice-servers", response_model=IceConfig, dependencies=[Depends(rate_limit("ice-servers", 30, 60))])
def ice_servers(user: User = Depends(get_current_user)) -> IceConfig:
    """STUN, plus TURN with short-lived credentials for the signed-in user when TURN is configured."""
    return build_ice_config(user.id)
