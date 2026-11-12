"""Create (or verify) the private avatar bucket.  python scripts/setup_supabase_storage.py

The bucket is PRIVATE: avatars are served through short-lived signed URLs created
by the backend, so friends-only/private profiles stay private. Idempotent.
"""

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings  # noqa: E402

if not (settings.supabase_url and settings.supabase_service_role_key):
    raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env")

headers = {"apikey": settings.supabase_service_role_key}
base = f"{settings.supabase_url}/storage/v1/bucket"
name = settings.supabase_avatar_bucket
existing = {b["name"]: b for b in httpx.get(base, headers=headers, timeout=20).raise_for_status().json()}
config = {
    "public": False,
    "file_size_limit": 2 * 1024 * 1024,
    "allowed_mime_types": ["image/png", "image/jpeg", "image/webp"],
}
if name in existing:
    r = httpx.put(f"{base}/{name}", headers=headers, json=config, timeout=20)
    print("updated" if r.is_success else f"update failed {r.status_code}", name)
else:
    r = httpx.post(base, headers=headers, json={"id": name, "name": name, **config}, timeout=20)
    print("created" if r.is_success else f"create failed {r.status_code} {r.text[:150]}", name)
b = httpx.get(f"{base}/{name}", headers=headers, timeout=20).json()
print({k: b.get(k) for k in ("name", "public", "file_size_limit", "allowed_mime_types")})
