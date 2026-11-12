"""Application-level authenticated encryption for selected sensitive fields.

This is layer 4 of Meetly's layered encryption. It is NOT end-to-end
encryption: the server holds the keys and can decrypt.

Envelope (text, safe to store in a VARCHAR/TEXT column)::

    enc:v1:<key_version>:<base64url(nonce || ciphertext || tag)>

* Algorithm: AES-256-GCM (``cryptography``), 96-bit random nonce per call.
* ``aad`` (associated data) binds a ciphertext to its location, e.g.
  ``"users.email:42"``, so a value copied into another row fails to decrypt.
* Keys come only from ``FIELD_ENCRYPTION_KEYS`` (``version:base64key`` pairs,
  comma separated). The key whose version equals ``FIELD_ENCRYPTION_KEY_VERSION``
  encrypts; every configured version can decrypt, which is how rotation works:
  add the new key, switch the active version, re-encrypt with ``rotate()``,
  then retire the old key. Keys are never stored in the database or logged.
* The leading ``v1`` names the *algorithm/format* so another scheme can be
  introduced later without breaking old rows.
"""

from __future__ import annotations

import base64
import binascii
import os
import re
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PREFIX = "enc:"
FORMAT = "v1"
_NONCE_BYTES = 12
_KEY_BYTES = 32
_VERSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")


class CryptoConfigError(RuntimeError):
    """Encryption is not configured correctly (never includes key material)."""


class DecryptionError(Exception):
    """Ciphertext is malformed, tampered with, for another location, or its key is gone."""


def generate_key() -> str:
    """A new random 256-bit key, base64url encoded, for FIELD_ENCRYPTION_KEYS."""
    return base64.urlsafe_b64encode(os.urandom(_KEY_BYTES)).decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(frozen=True)
class FieldCipher:
    keys: dict[str, bytes]
    active_version: str

    @classmethod
    def from_settings(cls, keys_spec: str, active_version: str) -> "FieldCipher":
        keys: dict[str, bytes] = {}
        for item in (p.strip() for p in keys_spec.split(",") if p.strip()):
            version, sep, material = item.partition(":")
            if not sep or not _VERSION_RE.match(version):
                raise CryptoConfigError("FIELD_ENCRYPTION_KEYS must be version:key pairs")
            try:
                key = _b64decode(material)
            except (binascii.Error, ValueError) as exc:
                raise CryptoConfigError(f"Key {version} is not valid base64") from exc
            if len(key) != _KEY_BYTES:
                raise CryptoConfigError(f"Key {version} must decode to exactly 32 bytes")
            keys[version] = key
        if not keys:
            raise CryptoConfigError("FIELD_ENCRYPTION_KEYS is not set")
        if active_version not in keys:
            raise CryptoConfigError("FIELD_ENCRYPTION_KEY_VERSION has no matching key")
        return cls(keys=keys, active_version=active_version)

    def encrypt(self, plaintext: str, *, aad: str) -> str:
        nonce = os.urandom(_NONCE_BYTES)
        sealed = AESGCM(self.keys[self.active_version]).encrypt(
            nonce, plaintext.encode("utf-8"), aad.encode("utf-8")
        )
        token = base64.urlsafe_b64encode(nonce + sealed).decode("ascii").rstrip("=")
        return f"{PREFIX}{FORMAT}:{self.active_version}:{token}"

    def decrypt(self, value: str, *, aad: str) -> str:
        parts = value.split(":", 3)
        if len(parts) != 4 or parts[0] + ":" != PREFIX or parts[1] != FORMAT:
            raise DecryptionError("Unsupported or malformed ciphertext")
        key = self.keys.get(parts[2])
        if key is None:
            raise DecryptionError("Encryption key for this value is not available")
        try:
            raw = _b64decode(parts[3])
            if len(raw) < _NONCE_BYTES + 16:
                raise DecryptionError("Ciphertext too short")
            plain = AESGCM(key).decrypt(raw[:_NONCE_BYTES], raw[_NONCE_BYTES:], aad.encode("utf-8"))
            return plain.decode("utf-8")
        except (InvalidTag, binascii.Error, ValueError) as exc:
            # Deliberately generic: do not reveal whether tag, aad or key was wrong.
            raise DecryptionError("Could not decrypt value") from exc

    def is_encrypted(self, value: str | None) -> bool:
        return bool(value) and value.startswith(f"{PREFIX}{FORMAT}:")

    def needs_rotation(self, value: str) -> bool:
        return self.is_encrypted(value) and value.split(":", 3)[2] != self.active_version

    def rotate(self, value: str, *, aad: str) -> str:
        """Re-encrypt under the active key (a no-op when already current)."""
        if not self.needs_rotation(value):
            return value
        return self.encrypt(self.decrypt(value, aad=aad), aad=aad)


def get_field_cipher() -> FieldCipher:
    """The cipher built from settings (raises CryptoConfigError if unconfigured)."""
    from app.config import settings

    return FieldCipher.from_settings(
        settings.field_encryption_keys, settings.field_encryption_key_version
    )
