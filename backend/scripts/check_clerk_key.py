"""Check whether a Clerk secret key is currently accepted by Clerk. Never prints the key.

    python scripts/check_clerk_key.py                      # keys found in the local env files
    CLERK_KEY_TO_CHECK=sk_test_... python scripts/check_clerk_key.py   # one specific key

Use it during rotation: the NEW key must print ACTIVE, the OLD key must print REJECTED.
Only a status code is read from Clerk (GET /v1/users?limit=1); no user data is printed.
"""

import hashlib
import os
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
FILES = [ROOT / "backend/.env", ROOT / "frontend/.env.local", ROOT / ".env.local"]


def fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:8]  # lets you tell keys apart without showing them


def kind(key: str) -> str:
    return "test" if key.startswith("sk_test_") else "LIVE" if key.startswith("sk_live_") else "unknown"


def status_of(key: str) -> str:
    try:
        r = httpx.get(
            "https://api.clerk.com/v1/users",
            params={"limit": 1},
            headers={"Authorization": f"Bearer {key}"},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        return f"UNREACHABLE ({type(exc).__name__})"
    if r.status_code == 200:
        return "ACTIVE"
    if r.status_code in (401, 403):
        return "REJECTED"
    return f"UNKNOWN (HTTP {r.status_code})"


def main() -> int:
    override = os.getenv("CLERK_KEY_TO_CHECK", "").strip()
    sources = [("CLERK_KEY_TO_CHECK", override)] if override else [
        (str(f.relative_to(ROOT)), (dotenv_values(f).get("CLERK_SECRET_KEY") or "").strip())
        for f in FILES if f.exists()
    ]
    if not any(k for _, k in sources):
        print("No Clerk secret key found.")
        return 1
    worst = 0
    for name, key in sources:
        if not key:
            print(f"{name}: (not set)")
            continue
        state = status_of(key)
        print(f"{name}: {kind(key)} key, fingerprint {fingerprint(key)}, {state}")
        worst = max(worst, 0 if state in ("ACTIVE", "REJECTED") else 2)
    return worst


if __name__ == "__main__":
    sys.exit(main())
