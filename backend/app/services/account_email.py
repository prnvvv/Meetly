"""The single place that reads, writes and looks up account emails.

Clerk is the identity provider and the source of truth for an account email; Meetly keeps
a copy only to show the owner their own address. That copy is personal data, so it is stored
encrypted (AES-256-GCM) with a keyed blind index (HMAC-SHA-256) for exact-match lookup and
uniqueness. Nothing here is used for authentication: sign-in maps the Clerk id to a user.

Modes (``EMAIL_ENCRYPTION_MODE``), a staged roll-out:
  off        plaintext only (the historical behaviour; the default)
  dual       plaintext + ciphertext + blind index (reads prefer the ciphertext)
  encrypted  ciphertext + blind index; the plaintext column holds only a placeholder

No function logs an address or key material.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.user import User
from app.security.blind_index import BlindIndex, BlindIndexConfigError, InvalidEmail, normalize_email
from app.security.crypto import CryptoConfigError, DecryptionError, FieldCipher

logger = logging.getLogger(__name__)

PURPOSE = "users.email"
MASK_DOMAIN = "masked.invalid"


def mode() -> str:
    return settings.email_encryption_mode


def aad_for(user_id: int) -> str:
    return f"users.email:{user_id}"


def masked_placeholder(user_id: int) -> str:
    """A unique, non-identifying value for the legacy plaintext column."""
    return f"masked-{user_id}@{MASK_DOMAIN}"


def is_masked(value: str | None) -> bool:
    return bool(value) and value.endswith("@" + MASK_DOMAIN)


@lru_cache(maxsize=8)
def _cipher_for(keys: str, version: str) -> FieldCipher:
    return FieldCipher.from_settings(keys, version)


@lru_cache(maxsize=8)
def _index_for(keys: str, version: str) -> BlindIndex:
    return BlindIndex.from_settings(keys, version)


def cipher() -> FieldCipher:
    return _cipher_for(settings.field_encryption_keys, settings.field_encryption_key_version)


def blind_index() -> BlindIndex:
    return _index_for(settings.field_blind_index_keys, settings.field_blind_index_key_version)


def seal(user_id: int, normalised: str) -> dict[str, str]:
    """The encrypted columns for ``normalised`` (raises CryptoConfigError/BlindIndexConfigError)."""
    c, b = cipher(), blind_index()
    return {
        "email_ciphertext": c.encrypt(normalised, aad=aad_for(user_id)),
        "email_key_version": c.active_version,
        "email_blind_index": b.index(PURPOSE, normalised),
        "email_bidx_version": b.active_version,
    }


def set_email(user: User, raw: str) -> None:
    """Store ``raw`` on ``user`` according to the current mode.

    ``user.id`` must exist when the mode is not ``off`` (flush first): the ciphertext is
    bound to the row id, so a value copied onto another row cannot be decrypted.
    """
    if mode() == "off":
        user.email = raw
        return
    normalised = normalize_email(raw)  # InvalidEmail propagates; callers decide
    if user.id is None:
        raise RuntimeError("flush the user before setting an encrypted email")
    for column, value in seal(user.id, normalised).items():
        setattr(user, column, value)
    user.email = normalised if mode() == "dual" else masked_placeholder(user.id)


def get_email(user: User) -> str | None:
    """The account email, or None if it is unknown or cannot be decrypted."""
    if user.email_ciphertext:
        try:
            return cipher().decrypt(user.email_ciphertext, aad=aad_for(user.id))
        except (DecryptionError, CryptoConfigError):
            logger.warning("Could not decrypt the email of user id=%s (key or data problem)", user.id)
    return None if is_masked(user.email) else user.email


def find_by_email(db: Session, raw: str) -> User | None:
    """Exact-match lookup. Case-insensitive; also covers rows not yet backfilled."""
    try:
        normalised = normalize_email(raw)
    except InvalidEmail:
        return None
    conditions = [func.lower(User.email) == normalised]  # legacy plaintext rows
    if mode() != "off":
        try:
            conditions.append(User.email_blind_index.in_(blind_index().candidates(PURPOSE, normalised)))
        except (BlindIndexConfigError, CryptoConfigError):
            logger.warning("Email lookup skipped the blind index: keys are not configured")
    return db.scalars(select(User).where(or_(*conditions)).limit(1)).first()
