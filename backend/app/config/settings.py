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


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _supabase_origin(raw: str) -> str:
    """Project origin only: tolerates a pasted /rest/v1 (or any) path suffix."""
    from urllib.parse import urlsplit

    parts = urlsplit(raw)
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else raw.rstrip("/")


def _env(name: str, default: str = "") -> str:
    """Environment value; blank and unset both mean "use the default"."""
    return os.getenv(name, "").strip() or default


class Settings:
    """Application configuration.

    This class never creates a database engine. It only exposes the
    ``DATABASE_URL`` value for informational purposes; engine and session
    construction stay owned by ``app.database``.
    """

    def __init__(self) -> None:
        self.app_name: str = os.getenv("APP_NAME", "Scalar Meeting API")
        # local | test | staging | production. Production turns on the safety
        # checks in `validate_for_production`.
        self.app_env: str = _env("APP_ENV", "local").lower()
        self.database_url: str = _env("DATABASE_URL", "sqlite:///./data/zoom_clone.db")
        # Session pooler / direct connection used only by Alembic and the data
        # migration (the transaction pooler cannot run DDL reliably).
        self.database_direct_url: str = _env("DATABASE_DIRECT_URL")
        self.database_pool_size: int = _env_int("DATABASE_POOL_SIZE", 5)
        self.database_max_overflow: int = _env_int("DATABASE_MAX_OVERFLOW", 5)
        # "require" encrypts; "verify-full" also validates the server certificate.
        self.database_ssl_mode: str = _env("DATABASE_SSL_MODE", "require")
        # "true" for Supabase's transaction pooler (PgBouncer): the driver must
        # not use server-side prepared statements.
        # Run request transactions as the low-privilege `meetly_app` role under Row Level
        # Security (PostgreSQL only). Off by default; see app/database/rls.py.
        self.database_rls_enforce: bool = _env("DATABASE_RLS_ENFORCE", "false").lower() == "true"
        self.database_use_pooler: bool = _env("DATABASE_USE_POOLER", "false").lower() == "true"

        # Supabase. The service-role key bypasses RLS: backend only, never the
        # browser, never logged.
        self.supabase_url: str = _supabase_origin(_env("SUPABASE_URL"))
        self.supabase_service_role_key: str = _env("SUPABASE_SERVICE_ROLE_KEY")
        self.supabase_avatar_bucket: str = _env("SUPABASE_AVATAR_BUCKET", "avatars")

        # Application-level field encryption (AES-256-GCM). FIELD_ENCRYPTION_KEYS is
        # "version:base64key" pairs, comma separated; the highest listed
        # FIELD_ENCRYPTION_KEY_VERSION encrypts, every listed version decrypts.
        self.field_encryption_keys: str = _env("FIELD_ENCRYPTION_KEYS")
        self.field_encryption_key_version: str = _env("FIELD_ENCRYPTION_KEY_VERSION", "1")
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
    def is_production(self) -> bool:
        return self.app_env == "production"

    def validate_for_production(self) -> list[str]:
        """Problems that must block startup in production (empty list = fine)."""
        if not self.is_production:
            return []
        problems: list[str] = []
        if self.auth_mode != "clerk":
            problems.append("AUTH_MODE must be 'clerk' in production")
        if not self.clerk_jwks_url:
            problems.append("CLERK_PUBLISHABLE_KEY (or CLERK_JWKS_URL) is required")
        if not self.clerk_authorized_parties:
            problems.append("CLERK_AUTHORIZED_PARTIES must list the frontend origin(s)")
        if not self.database_url.startswith("sqlite") and self.database_ssl_mode == "disable":
            problems.append("DATABASE_SSL_MODE must not be 'disable' in production")
        for origin in self.cors_origins:
            if not origin.startswith("https://"):
                problems.append(f"FRONTEND_URL origin must use https in production: {origin}")
        return problems

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_url.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()