"""Row Level Security policies and the low-privilege application role

PostgreSQL only (no-op on SQLite). Creates the NOLOGIN role ``meetly_app``, grants it
exactly the tables Meetly needs, and installs the per-table policies described in
app/database/rls.py. Nothing changes for the running app until DATABASE_RLS_ENFORCE=true
makes request transactions run as that role; the owner login used today is unaffected.

Policy text lives in app/database/rls.py. Future policy changes belong in a NEW revision
that re-runs ``policy_statements`` (they are idempotent), never in an edit of this one.

Revision ID: 0008
Revises: 0007
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    from app.database import rls

    for statement in rls.role_statements() + rls.policy_statements("public"):
        op.execute(statement)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    from app.database import rls

    for statement in rls.drop_statements("public"):
        op.execute(statement)
