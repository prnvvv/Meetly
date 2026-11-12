"""revoke Supabase API roles from Meetly tables

Meetly never lets the browser query Supabase directly (all access goes through
the FastAPI backend), so Supabase's PostgREST roles get no privileges on the
public schema. RLS is also enabled on every table by Supabase's default event
trigger; this revision makes the lock-down explicit and covers future tables.
No-op on SQLite and on PostgreSQL servers without these roles.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

ROLES = ("anon", "authenticated")


def _each_existing_role(statement: str) -> None:
    for role in ROLES:
        op.execute(
            f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN "
            f"{statement.format(role=role)}; END IF; END $$"
        )


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    _each_existing_role("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role}")
    _each_existing_role("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role}")
    _each_existing_role(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM {role}"
    )
    _each_existing_role(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM {role}"
    )


def downgrade() -> None:
    # Intentionally does not re-grant: restoring browser access to the tables
    # would be a security regression and must be a deliberate, separate decision.
    pass
