from __future__ import annotations

import base64
import os
from functools import lru_cache
from pathlib import Path

try:  # python-dotenv is already a dependency; .env is optional.
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:  # pragma: no cover
    pass


def _clerk_domain(publishable_key: str) -> str:
    """The Clerk frontend API domain encoded in a publishable key (a public value)."""
    try:
        encoded = publishable_key.split("_", 2)[2]
        encoded += "=" * (-len(encoded) % 4)
        return base64.b64decode(encoded).decode("utf-8").rstrip("$")
    except (IndexError, ValueError, UnicodeDecodeError):
        return ""


class Settings:
    """Realtime-side configuration.

    This class never creates a database engine. It only exposes the
    ``DATABASE_URL`` value for informational purposes; engine and session
    construction stay owned by ``app.database``.
    """

    def __init__(self) -> None:
        self.app_name: str = os.getenv("APP_NAME", "Scalar Meeting API")
        self.database_url: str = os.getenv(
            "DATABASE_URL",
            "sqlite:///./data/zoom_clone.db",
        )
        self.frontend_url: str = os.getenv(
            "FRONTEND_URL",
            "http://localhost:3000,http://192.168.1.10:3000",
        )
        self.stun_server: str = os.getenv(
            "STUN_SERVER",
            "stun:stun.l.google.com:19302",
        )

        # Authentication. "clerk" verifies Clerk session tokens on every request;
        # "demo" skips verification and acts as the seeded demo user. It exists
        # for local development and tests only and must never be used in production.
        self.auth_mode: str = os.getenv("AUTH_MODE", "clerk").strip().lower()
        publishable = os.getenv("CLERK_PUBLISHABLE_KEY") or os.getenv(
            "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", ""
        )
        domain = _clerk_domain(publishable) if publishable else ""
        default_issuer = f"https://{domain}" if domain else ""
        self.clerk_issuer: str = os.getenv("CLERK_ISSUER", default_issuer).rstrip("/")
        self.clerk_jwks_url: str = os.getenv(
            "CLERK_JWKS_URL",
            f"{default_issuer}/.well-known/jwks.json" if default_issuer else "",
        )
        # Optional: lets the API read a new user's name/email from Clerk.
        self.clerk_secret_key: str = os.getenv("CLERK_SECRET_KEY", "")
        # Comma-separated origins allowed in the token's `azp` claim (optional).
        self.clerk_authorized_parties: list[str] = [
            p.strip() for p in os.getenv("CLERK_AUTHORIZED_PARTIES", "").split(",") if p.strip()
        ]

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_url.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()