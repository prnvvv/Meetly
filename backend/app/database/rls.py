"""PostgreSQL Row Level Security for Meetly (a second wall behind the API checks).

How identity reaches the database
---------------------------------
The API authenticates with Clerk and knows the internal ``users.id``. When
``DATABASE_RLS_ENFORCE=true`` every request transaction starts with::

    SELECT set_config('app.user_id', '<verified internal id>', true);
    SET LOCAL ROLE meetly_app;

``meetly_app`` is a plain role: not superuser, not BYPASSRLS, owns nothing. The
connection itself stays the normal owner login (so no extra password exists), and
``LOCAL`` makes both settings end with the transaction, which is what makes this safe
through Supabase's transaction pooler. The id comes only from the verified token, never
from a request field. Code paths that run before the user is known (finding or creating
the account from a Clerk id) run as the owner and do not use this.

What it protects, and what it does not
--------------------------------------
Policies make SQL issued on behalf of user A unable to read or change user B private rows
even if an API check is missing (IDOR, forgotten filter, injection). They do not defend
against a compromised backend, which can set any id. A few cross-user writes the app must
perform are allowed on purpose and listed in docs/architecture/SECURITY_ARCHITECTURE.md:
creating notifications for someone else, recording meeting history, and moving a meeting
between scheduled/active/ended.

Cross-table checks use SECURITY DEFINER helper functions, which avoids "infinite recursion"
between policies. Tables with no grant for ``meetly_app`` (alembic_version, activity_events,
the unused legacy invitations table) are simply inaccessible to it.
"""

from __future__ import annotations

ROLE = "meetly_app"

#: Tables the application role may touch. Everything else is denied.
TABLES = (
    "users",
    "user_profiles",
    "meetings",
    "participants",
    "meeting_history",
    "friend_requests",
    "friendships",
    "user_blocks",
    "notifications",
    "meeting_invitations",
    "waiting_room_entries",
)


def _q(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def role_statements() -> list[str]:
    """Create the role (idempotent) and allow the current login to SET ROLE to it."""
    return [
        f"""
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}') THEN
    CREATE ROLE {ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END $$""",
        f"""
DO $$ BEGIN
  BEGIN
    EXECUTE 'GRANT {ROLE} TO ' || quote_ident(current_user) || ' WITH SET TRUE, INHERIT FALSE';
  EXCEPTION WHEN syntax_error THEN
    EXECUTE 'GRANT {ROLE} TO ' || quote_ident(current_user);
  END;
END $$""",
    ]


def policy_statements(schema: str = "public") -> list[str]:
    """DDL that grants the role access and installs every policy in ``schema``. Idempotent."""
    s = _q(schema)
    me = f"{s}.app_user_id()"
    statements: list[str] = []
    add = statements.append

    # -- helper functions -----------------------------------------------------------
    add(f"""
CREATE OR REPLACE FUNCTION {s}.app_user_id() RETURNS integer
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::integer $$""")

    def definer(name: str, args: str, body: str) -> None:
        add(f"""
CREATE OR REPLACE FUNCTION {s}.{name}({args}) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$ {body} $$""")
        add(f"REVOKE ALL ON FUNCTION {s}.{name}({args.split(' ', 1)[1] if args else ''}) FROM PUBLIC")
        add(f"GRANT EXECUTE ON FUNCTION {s}.{name}({args.split(' ', 1)[1] if args else ''}) TO {ROLE}")

    definer("app_is_host", "m integer",
            f"SELECT EXISTS (SELECT 1 FROM {s}.meetings WHERE id = m AND host_id = {me})")
    definer("app_in_meeting", "m integer",
            f"SELECT EXISTS (SELECT 1 FROM {s}.meetings WHERE id = m AND host_id = {me}) "
            f"OR EXISTS (SELECT 1 FROM {s}.participants WHERE meeting_id = m AND user_id = {me})")
    definer("app_is_friend", "o integer",
            f"SELECT EXISTS (SELECT 1 FROM {s}.friendships WHERE "
            f"user_low_id = LEAST(o, {me}) AND user_high_id = GREATEST(o, {me}))")
    definer("app_blocked_by", "o integer",
            f"SELECT EXISTS (SELECT 1 FROM {s}.user_blocks WHERE blocker_id = o AND blocked_id = {me})")
    definer("app_i_blocked", "o integer",
            f"SELECT EXISTS (SELECT 1 FROM {s}.user_blocks WHERE blocker_id = {me} AND blocked_id = o)")
    add(f"GRANT EXECUTE ON FUNCTION {s}.app_user_id() TO {ROLE}")

    # -- grants -----------------------------------------------------------------------
    add(f"GRANT USAGE ON SCHEMA {s} TO {ROLE}")
    for table in TABLES:
        add(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {s}.{_q(table)} TO {ROLE}")
    add(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {s} TO {ROLE}")

    for table in TABLES:
        add(f"ALTER TABLE {s}.{_q(table)} ENABLE ROW LEVEL SECURITY")

    def policy(table: str, name: str, command: str, using: str | None = None, check: str | None = None) -> None:
        add(f"DROP POLICY IF EXISTS {_q(name)} ON {s}.{_q(table)}")
        clause = f"CREATE POLICY {_q(name)} ON {s}.{_q(table)} AS PERMISSIVE FOR {command} TO {ROLE}"
        if using:
            clause += f" USING ({using})"
        if check:
            clause += f" WITH CHECK ({check})"
        add(clause)

    # -- users: only your own row ---------------------------------------------------------
    policy("users", "users_select_own", "SELECT", using=f"id = {me}")
    policy("users", "users_update_own", "UPDATE", using=f"id = {me}", check=f"id = {me}")

    # -- profiles: own; others unless private (friends excepted) or they blocked you -----
    policy("user_profiles", "profiles_select", "SELECT",
           using=f"user_id = {me} OR ({me} IS NOT NULL AND NOT {s}.app_blocked_by(user_id) AND "
                 f"(visibility <> 'private' OR {s}.app_is_friend(user_id) OR {s}.app_i_blocked(user_id)))")
    policy("user_profiles", "profiles_insert_own", "INSERT", check=f"user_id = {me}")
    policy("user_profiles", "profiles_update_own", "UPDATE", using=f"user_id = {me}", check=f"user_id = {me}")

    # -- friend requests / friendships / blocks -----------------------------------------------
    policy("friend_requests", "fr_select", "SELECT", using=f"sender_id = {me} OR receiver_id = {me}")
    policy("friend_requests", "fr_insert", "INSERT", check=f"sender_id = {me}")
    policy("friend_requests", "fr_update", "UPDATE",
           using=f"sender_id = {me} OR receiver_id = {me}", check=f"sender_id = {me} OR receiver_id = {me}")
    policy("friendships", "fs_select", "SELECT", using=f"user_low_id = {me} OR user_high_id = {me}")
    policy("friendships", "fs_insert", "INSERT", check=f"user_low_id = {me} OR user_high_id = {me}")
    policy("friendships", "fs_delete", "DELETE", using=f"user_low_id = {me} OR user_high_id = {me}")
    # Blocks are readable by both sides (the app must hide a blocker from the blocked), writable by the blocker only.
    policy("user_blocks", "ub_select", "SELECT", using=f"blocker_id = {me} OR blocked_id = {me}")
    policy("user_blocks", "ub_insert", "INSERT", check=f"blocker_id = {me}")
    policy("user_blocks", "ub_delete", "DELETE", using=f"blocker_id = {me}")

    # -- notifications: yours; the person who caused one may also retract it -------------------
    actor = "(payload ->> 'actor_id')::integer"
    policy("notifications", "nt_select", "SELECT", using=f"recipient_id = {me} OR {actor} = {me}")
    policy("notifications", "nt_insert", "INSERT", check=f"{me} IS NOT NULL")
    policy("notifications", "nt_update", "UPDATE", using=f"recipient_id = {me}", check=f"recipient_id = {me}")
    policy("notifications", "nt_delete", "DELETE", using=f"recipient_id = {me} OR {actor} = {me}")

    # -- meetings and what hangs off them ----------------------------------------------------------
    policy("meetings", "meetings_select", "SELECT", using=f"{me} IS NOT NULL")
    policy("meetings", "meetings_insert", "INSERT", check=f"host_id = {me}")
    policy("meetings", "meetings_update", "UPDATE",
           using=f"host_id = {me} OR status IN ('scheduled', 'active')", check=f"{me} IS NOT NULL")
    policy("participants", "pt_select", "SELECT", using=f"user_id = {me} OR {s}.app_in_meeting(meeting_id)")
    policy("participants", "pt_insert", "INSERT", check=f"user_id = {me} OR {s}.app_is_host(meeting_id)")
    policy("participants", "pt_update", "UPDATE",
           using=f"user_id = {me} OR {s}.app_is_host(meeting_id)",
           check=f"user_id = {me} OR {s}.app_is_host(meeting_id)")
    policy("meeting_history", "mh_select", "SELECT", using=f"{s}.app_in_meeting(meeting_id)")
    policy("meeting_history", "mh_insert", "INSERT", check=f"{me} IS NOT NULL")
    policy("meeting_history", "mh_update", "UPDATE", using=f"{me} IS NOT NULL", check=f"{me} IS NOT NULL")

    policy("meeting_invitations", "mi_select", "SELECT",
           using=f"inviter_id = {me} OR invitee_id = {me} OR {s}.app_is_host(meeting_id)")
    policy("meeting_invitations", "mi_insert", "INSERT", check=f"inviter_id = {me}")
    policy("meeting_invitations", "mi_update", "UPDATE",
           using=f"inviter_id = {me} OR invitee_id = {me} OR {s}.app_is_host(meeting_id)",
           check=f"inviter_id = {me} OR invitee_id = {me} OR {s}.app_is_host(meeting_id)")

    policy("waiting_room_entries", "wr_select", "SELECT", using=f"user_id = {me} OR {s}.app_is_host(meeting_id)")
    policy("waiting_room_entries", "wr_insert", "INSERT", check=f"user_id = {me}")
    policy("waiting_room_entries", "wr_update", "UPDATE",
           using=f"user_id = {me} OR {s}.app_is_host(meeting_id)",
           check=f"user_id = {me} OR {s}.app_is_host(meeting_id)")
    return statements


def drop_statements(schema: str = "public") -> list[str]:
    """Remove the policies and helpers again (used by the migration downgrade)."""
    s = _q(schema)
    out = []
    for table in TABLES:
        out.append(f"REVOKE ALL ON {s}.{_q(table)} FROM {ROLE}")
    for fn in ("app_is_host(integer)", "app_in_meeting(integer)", "app_is_friend(integer)",
               "app_blocked_by(integer)", "app_i_blocked(integer)", "app_user_id()"):
        out.append(f"DROP FUNCTION IF EXISTS {s}.{fn} CASCADE")
    return out


def bind_session(db, user_id: int) -> None:
    """Attach the verified user to a session so its transactions run under RLS.

    No-op unless ``DATABASE_RLS_ENFORCE`` is on and the database is PostgreSQL. Any
    transaction already open (it ran as the owner to find the account) is ended so the
    next statement starts a transaction under the role.
    """
    from app.config import settings

    if not settings.database_rls_enforce:
        return
    db.info["rls_user_id"] = int(user_id)
    if db.in_transaction():
        db.commit()
