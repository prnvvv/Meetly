"""Supabase Storage access for avatars (service-role key, backend only).

The avatar bucket is private. Browsers receive short-lived signed URLs that the
backend only issues to viewers allowed to see the avatar. The key is sent in the
``apikey`` header and never logged or returned.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Protocol

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

SIGNED_URL_TTL = 3600
_CACHE_SKEW = 300  # reuse a signed URL only while >=5 minutes of validity remain


class StorageUnavailable(Exception):
    """Storage is not configured or the provider failed."""


class AvatarStorage(Protocol):
    def upload(self, path: str, data: bytes, content_type: str) -> None: ...
    def delete(self, paths: list[str]) -> None: ...
    def sign_many(self, paths: list[str]) -> dict[str, str]: ...


class SupabaseAvatarStorage:
    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(settings.supabase_url and settings.supabase_service_role_key)

    def _client(self) -> httpx.Client:
        if not self.configured:
            raise StorageUnavailable("Avatar storage is not configured")
        return httpx.Client(
            base_url=f"{settings.supabase_url}/storage/v1",
            headers={"apikey": settings.supabase_service_role_key},
            timeout=10.0,
        )

    @property
    def bucket(self) -> str:
        return settings.supabase_avatar_bucket

    def upload(self, path: str, data: bytes, content_type: str) -> None:
        try:
            with self._client() as c:
                r = c.post(
                    f"/object/{self.bucket}/{path}",
                    content=data,
                    headers={"Content-Type": content_type, "x-upsert": "true"},
                )
                r.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Avatar upload failed: %s", type(exc).__name__)
            raise StorageUnavailable("Could not store the avatar") from exc

    def delete(self, paths: list[str]) -> None:
        if not paths or not self.configured:
            return
        try:
            with self._client() as c:
                c.request("DELETE", f"/object/{self.bucket}", json={"prefixes": paths}).raise_for_status()
        except httpx.HTTPError as exc:  # best effort: an orphan object is harmless
            logger.warning("Avatar delete failed: %s", type(exc).__name__)
        with self._lock:
            for p in paths:
                self._cache.pop(p, None)

    def sign_many(self, paths: list[str]) -> dict[str, str]:
        """{path: absolute signed URL}; paths that cannot be signed are omitted."""
        if not paths or not self.configured:
            return {}
        now = time.time()
        result: dict[str, str] = {}
        missing: list[str] = []
        with self._lock:
            for p in set(paths):
                hit = self._cache.get(p)
                if hit and hit[0] - now > _CACHE_SKEW:
                    result[p] = hit[1]
                else:
                    missing.append(p)
        if missing:
            try:
                with self._client() as c:
                    r = c.post(
                        f"/object/sign/{self.bucket}",
                        json={"expiresIn": SIGNED_URL_TTL, "paths": missing},
                    )
                    r.raise_for_status()
                    signed = r.json()
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning("Avatar signing failed: %s", type(exc).__name__)
                return result
            with self._lock:
                for item in signed:
                    rel, path = item.get("signedURL"), item.get("path")
                    if not rel or not path:
                        continue
                    url = f"{settings.supabase_url}/storage/v1{rel}"
                    self._cache[path] = (now + SIGNED_URL_TTL, url)
                    result[path] = url
        return result


_storage: AvatarStorage = SupabaseAvatarStorage()


def get_storage() -> AvatarStorage:
    return _storage


def set_storage(storage: AvatarStorage) -> None:
    """Test seam."""
    global _storage
    _storage = storage
