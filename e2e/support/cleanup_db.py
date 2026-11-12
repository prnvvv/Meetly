"""Remove the rows that belong to the two E2E test users from the development database.

Usage (from backend/): python ../e2e/support/cleanup_db.py [--apply]
Without --apply it only counts. Rows are selected strictly by the two users'
Clerk ids from e2e/.e2e-users.json and the meetings THEY host; nothing else.
"""
import json, pathlib, sys
from sqlalchemy import text
from app.database import SessionLocal

ROOT = pathlib.Path(__file__).resolve().parents[2]
ids = [v["id"] for v in json.loads((ROOT / "e2e" / ".e2e-users.json").read_text()).values()]
apply = "--apply" in sys.argv

with SessionLocal() as db:
    uid = [r[0] for r in db.execute(text("select id from users where clerk_id = any(:c)"), {"c": ids})] if db.bind.dialect.name == "postgresql" else []
    if not uid:
        print("no matching users"); raise SystemExit
    mid = [r[0] for r in db.execute(text("select id from meetings where host_id = any(:u)"), {"u": uid})]
    P = {"u": uid, "m": mid or [0]}
    steps = [
        ("waiting_room_entries", "meeting_id = any(:m) or user_id = any(:u)"),
        ("meeting_invitations", "meeting_id = any(:m) or inviter_id = any(:u) or invitee_id = any(:u)"),
        ("participants", "meeting_id = any(:m) or user_id = any(:u)"),
        ("meeting_history", "meeting_id = any(:m)"),
        ("notifications", "recipient_id = any(:u)"),
        ("friend_requests", "sender_id = any(:u) or receiver_id = any(:u)"),
        ("friendships", "user_low_id = any(:u) or user_high_id = any(:u)"),
        ("user_blocks", "blocker_id = any(:u) or blocked_id = any(:u)"),
        ("meetings", "id = any(:m)"),
        ("user_profiles", "user_id = any(:u)"),
        ("users", "id = any(:u)"),
    ]
    print("target host:", db.bind.url.host)
    for table, where in steps:
        try:
            n = db.execute(text(f"select count(*) from {table} where {where}"), P).scalar()
        except Exception as e:
            db.rollback(); print(f"{table}: skipped ({str(e).splitlines()[0][:90]})"); continue
        print(f"{table}: {n}")
        if apply and n:
            db.execute(text(f"delete from {table} where {where}"), P)
    if apply:
        db.commit(); print("deleted")
    else:
        db.rollback(); print("dry run only")
