"""Keyed blind index (HMAC-SHA-256) for looking up and de-duplicating encrypted values.

Randomised encryption (AES-GCM) cannot be searched or made unique, so a second column holds
``HMAC-SHA256(index_key, normalised value)``. An ordinary SHA-256 of an email would be a
dictionary-attackable stand-in; the key is what makes the index useless without the
application secret. The index key is SEPARATE from the encryption key, lives only in the
environment, and is versioned so it can be rotated: every row records the version it was
written with, and lookups try each configured version.

Not an index of anything secret you could range-scan: it supports exact match only.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
import unicodedata
from dataclasses import dataclass

_KEY_BYTES = 32
_VERSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_EMAIL_LENGTH = 254


class BlindIndexConfigError(RuntimeError):
    """The blind-index keys are missing or malformed (never includes key material)."""


class InvalidEmail(ValueError):
    pass


def normalize_email(value: str) -> str:
    """One canonical form per mailbox string: NFKC, trimmed, lower-cased.

    Deliberately does NOT strip dots or ``+tags``: those are provider-specific and would
    merge different real mailboxes.
    """
    email = unicodedata.normalize("NFKC", value or "").strip().lower()
    if not email or len(email) > MAX_EMAIL_LENGTH or not _EMAIL_RE.match(email):
        raise InvalidEmail("not a valid email address")
    return email


@dataclass(frozen=True)
class BlindIndex:
    keys: dict[str, bytes]
    active_version: str

    @classmethod
    def from_settings(cls, keys_spec: str, active_version: str) -> "BlindIndex":
        keys: dict[str, bytes] = {}
        for item in (p.strip() for p in keys_spec.split(",") if p.strip()):
            version, sep, material = item.partition(":")
            if not sep or not _VERSION_RE.match(version):
                raise BlindIndexConfigError("FIELD_BLIND_INDEX_KEYS must be version:key pairs")
            try:
                key = base64.urlsafe_b64decode(material + "=" * (-len(material) % 4))
            except (binascii.Error, ValueError) as exc:
                raise BlindIndexConfigError(f"Blind-index key {version} is not valid base64") from exc
            if len(key) != _KEY_BYTES:
                raise BlindIndexConfigError(f"Blind-index key {version} must decode to 32 bytes")
            keys[version] = key
        if not keys:
            raise BlindIndexConfigError("FIELD_BLIND_INDEX_KEYS is not set")
        if active_version not in keys:
            raise BlindIndexConfigError("FIELD_BLIND_INDEX_KEY_VERSION has no matching key")
        return cls(keys=keys, active_version=active_version)

    @staticmethod
    def _mac(key: bytes, purpose: str, normalised: str) -> str:
        # `purpose` domain-separates indexes so an email index is never valid for another field.
        return hmac.new(key, f"{purpose}:v1:{normalised}".encode(), hashlib.sha256).hexdigest()

    def index(self, purpose: str, normalised: str, version: str | None = None) -> str:
        return self._mac(self.keys[version or self.active_version], purpose, normalised)

    def candidates(self, purpose: str, normalised: str) -> list[str]:
        """The index under every configured key version (for lookups during/after rotation)."""
        return [self._mac(k, purpose, normalised) for k in self.keys.values()]


def generate_key() -> str:
    import os

    return base64.urlsafe_b64encode(os.urandom(_KEY_BYTES)).decode("ascii")
