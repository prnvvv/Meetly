"""Create or delete the two E2E test users in the Clerk DEVELOPMENT instance.

Usage: python support/clerk_users.py create|delete
Reads CLERK_SECRET_KEY from frontend/.env.local; never prints it. Writes the ids
to e2e/.e2e-users.json (git-ignored) so the tests and the cleanup know exactly
which users are ours.
"""
import json, pathlib, sys, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parents[2]
STATE = ROOT / "e2e" / ".e2e-users.json"
USERS = [
    ("host", "e2e-host", "E2E", "Host"),
    ("guest", "e2e-guest", "E2E", "Guest"),
]


def secret() -> str:
    for line in (ROOT / "frontend" / ".env.local").read_text().splitlines():
        if line.startswith("CLERK_SECRET_KEY="):
            key = line.split("=", 1)[1].strip().strip('"')
            assert key.startswith("sk_test_"), "refusing: not a development Clerk key"
            return key
    raise SystemExit("CLERK_SECRET_KEY not found")


def call(method, path, body=None):
    req = urllib.request.Request(
        "https://api.clerk.com/v1" + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {secret()}", "Content-Type": "application/json", "User-Agent": "meetly-e2e/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")


def create():
    state = {}
    for role, username, first, last in USERS:
        user = call("POST", "/users", {
            "email_address": [f"{username}+clerk_test@example.com"],
            "username": username,
            "first_name": first,
            "last_name": last,
            "skip_password_requirement": True,
        })
        state[role] = {"id": user["id"], "username": username}
        print("created", role, user["id"])
    STATE.write_text(json.dumps(state, indent=2))


def delete():
    state = json.loads(STATE.read_text())
    for role, info in state.items():
        call("DELETE", f"/users/{info['id']}")
        print("deleted", role, info["id"])
    STATE.unlink()


if __name__ == "__main__":
    {"create": create, "delete": delete}[sys.argv[1]]()
