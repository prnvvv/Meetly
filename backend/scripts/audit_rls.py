"""Read-only audit of Row Level Security in the configured database (never writes).

    python scripts/audit_rls.py

Prints, per table: RLS enabled, policies by command, and the privileges held by the app role
(meetly_app) and by the Supabase browser roles (anon, authenticated). Exits non-zero if any table is
missing RLS, if a browser role has any privilege, or if a table is neither covered by policies nor
explicitly denied.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import rls  # noqa: E402
from app.database.database import normalize_database_url  # noqa: E402
from app.database.target_guard import UnsafeDatabaseTarget, check_target  # noqa: E402

DENIED = {"activity_events", "invitations", "rate_limit_counters"}


def main() -> int:
    url = normalize_database_url(settings.database_direct_url or settings.database_url)
    try:
        target = check_target(url, app_env=settings.app_env, command="runtime")
    except UnsafeDatabaseTarget as exc:
        raise SystemExit(str(exc)) from None
    if target.is_sqlite:
        raise SystemExit("RLS exists only on PostgreSQL.")
    print("Auditing:", target.description, "\n")
    failures: list[str] = []
    with create_engine(url, connect_args={"sslmode": settings.database_ssl_mode}).connect() as c:
        c.execute(text("SET TRANSACTION READ ONLY"))
        tables = [r[0] for r in c.execute(text(
            "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname"))]
        policies: dict[str, dict[str, int]] = {}
        for tbl, cmd in c.execute(text("SELECT tablename, cmd FROM pg_policies WHERE schemaname = 'public'")):
            policies.setdefault(tbl, {})[cmd] = policies.get(tbl, {}).get(cmd, 0) + 1
        rls_on = dict(c.execute(text("SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'")).all())
        grants: dict[tuple[str, str], set[str]] = {}
        for tbl, who, priv in c.execute(text(
            "SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants "
            "WHERE table_schema = 'public' AND grantee IN ('meetly_app', 'anon', 'authenticated')")):
            grants.setdefault((tbl, who), set()).add(priv)
        print(f"{'table':24s} {'RLS':4s} {'policies (cmd:count)':32s} app-role privileges")
        for t in tables:
            if t == "alembic_version":
                continue
            pol = ", ".join(f"{k}:{v}" for k, v in sorted(policies.get(t, {}).items())) or "none"
            app = ",".join(sorted(grants.get((t, "meetly_app"), set()))) or "none"
            print(f"{t:24s} {'on' if rls_on.get(t) else 'OFF':4s} {pol:32s} {app}")
            if not rls_on.get(t):
                failures.append(f"{t}: RLS is off")
            for role in ("anon", "authenticated"):
                if grants.get((t, role)):
                    failures.append(f"{t}: browser role {role} holds {sorted(grants[(t, role)])}")
            extra = grants.get((t, "meetly_app"), set()) - set(policies.get(t, {})) if t in rls.TABLES else set()
            if extra:
                failures.append(f"{t}: app role holds {sorted(extra)} without a policy for it")
            if t in rls.TABLES and not policies.get(t):
                failures.append(f"{t}: granted to the app role but has no policies")
            if t in DENIED and (grants.get((t, "meetly_app")) or policies.get(t)):
                failures.append(f"{t}: must be closed to the app role")
            if t not in rls.TABLES and t not in DENIED:
                failures.append(f"{t}: no RLS decision recorded")
        print()
        print("alembic_version RLS:", "on" if rls_on.get("alembic_version") else "OFF (internal table, owner only)")
    for f in failures:
        print("FAIL:", f)
    print("RESULT:", "PASSED" if not failures else "FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
