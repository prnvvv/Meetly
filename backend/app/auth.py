"""Request authentication.

Production (``AUTH_MODE=clerk``): every request carries a Clerk session token
(``Authorization: Bearer <jwt>``). The token's RS256 signature is verified
against Clerk's public JWKS, its issuer and expiry are checked, and ``sub`` (the
Clerk user id) is mapped to a row in ``users``. The caller's identity never comes
from a client-supplied user id.

``AUTH_MODE=demo`` skips verification and acts as the seeded demo user. It is for
local development and tests only.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from functools import lru_cache
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database.database import utc_now
from app.database.rls import bind_session as bind_rls
from app.database.session import get_db
from app.services import account_email
from app.models.user import DEMO_USER_EMAIL, DEMO_USER_ID, DEMO_USER_NAME, User

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)
LAST_LOGIN_REFRESH = timedelta(hours=1)


class AuthError(Exception):
    """The supplied token is missing, malformed, expired or not trusted."""


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    if not settings.clerk_jwks_url:
        raise AuthError("Authentication is not configured (set CLERK_PUBLISHABLE_KEY or CLERK_JWKS_URL)")
    return jwt.PyJWKClient(settings.clerk_jwks_url, cache_keys=True, lifespan=3600)


def verify_token(token: str) -> dict[str, Any]:
    """Return the verified claims of a Clerk session token or raise AuthError."""
    try:
        key = _jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer or None,
            leeway=10,
            options={"require": ["exp", "sub"], "verify_iss": bool(settings.clerk_issuer)},
        )
    except AuthError:
        raise
    except jwt.PyJWTError as exc:
        raise AuthError("Invalid or expired session token") from exc
    except Exception as exc:  # network failure fetching keys, etc.
        logger.warning("Token verification failed: %s", type(exc).__name__)
        raise AuthError("Could not verify the session token") from exc

    parties = settings.clerk_authorized_parties
    if parties and claims.get("azp") not in parties:
        raise AuthError("Token was issued for a different application")
    return claims


def _profile_from_clerk(clerk_id: str) -> tuple[str, str]:
    """Best-effort name and email for a new user; falls back to neutral values."""
    name, email = "Meetly User", f"{clerk_id}@users.meetly.invalid"
    if not settings.clerk_secret_key:
        return name, email
    try:
        response = httpx.get(
            f"https://api.clerk.com/v1/users/{clerk_id}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            timeout=5.0,
        )
        response.raise_for_status()
        data = response.json()
        full = " ".join(p for p in (data.get("first_name"), data.get("last_name")) if p).strip()
        primary = next(
            (
                e.get("email_address")
                for e in data.get("email_addresses", [])
                if e.get("id") == data.get("primary_email_address_id")
            ),
            None,
        )
        return (full or data.get("username") or name)[:100], (primary or email)[:255]
    except Exception as exc:
        logger.warning("Could not read Clerk profile: %s", type(exc).__name__)
        return name, email


def _ensure_profile_quietly(db: Session, user: User) -> None:
    """Give a new account its profile; never let this block sign-in."""
    try:
        from app.services.profile_service import ensure_profile

        ensure_profile(db, user)
    except Exception as exc:
        db.rollback()
        logger.warning("Could not create profile: %s", type(exc).__name__)


def _create_user(db: Session, name: str, email: str, clerk_id: str, now) -> User:
    """Insert the account (email stored per EMAIL_ENCRYPTION_MODE). Safe under concurrent first requests."""
    import uuid

    from app.security.blind_index import InvalidEmail

    for attempt in range(2):
        user = User(
            name=name,
            email=f"pending-{uuid.uuid4().hex}@{account_email.MASK_DOMAIN}",
            clerk_id=clerk_id,
            last_login_at=now,
        )
        db.add(user)
        try:
            db.flush()  # the row id is needed to bind the encrypted email to the row
            if attempt == 0:
                try:
                    account_email.set_email(user, email)
                except InvalidEmail:
                    user.email = account_email.masked_placeholder(user.id)
            else:  # the address clashed with another account: sign in without a stored email
                user.email = account_email.masked_placeholder(user.id)
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.execute(select(User).where(User.clerk_id == clerk_id)).scalar_one_or_none()
            if existing is not None:  # two first requests raced: the other one created the row
                return existing
            continue  # e.g. the email already belongs to another account: retry without it
        db.refresh(user)
        _ensure_profile_quietly(db, user)
        return user
    raise AuthError("Could not create the account")


def _user_for_clerk_id(db: Session, clerk_id: str) -> User:
    user = db.execute(select(User).where(User.clerk_id == clerk_id)).scalar_one_or_none()
    now = utc_now()
    if user is None:
        name, email = _profile_from_clerk(clerk_id)
        user = _create_user(db, name, email, clerk_id, now)
    elif user.last_login_at is None or now - user.last_login_at > LAST_LOGIN_REFRESH:
        user.last_login_at = now
        db.commit()
    return user


def user_from_token(db: Session, token: str) -> User:
    """Resolve a bearer token (REST header or WebSocket join) to a user row."""
    if settings.auth_mode == "demo":
        user = db.get(User, DEMO_USER_ID)
        if user is None:  # init_db seeds it; a bare test database may not
            user = User(id=DEMO_USER_ID, name=DEMO_USER_NAME, email=DEMO_USER_EMAIL)
            db.add(user)
            db.commit()
        return user
    return _user_for_clerk_id(db, str(verify_token(token)["sub"]))


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency: the authenticated user, or 401."""
    if settings.auth_mode == "demo":
        return user_from_token(db, "")
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Sign in to continue",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user = user_from_token(db, credentials.credentials)
        bind_rls(db, user.id)  # from here on this request runs under Row Level Security
        return user
    except AuthError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
