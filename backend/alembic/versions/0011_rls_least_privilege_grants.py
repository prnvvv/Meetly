"""least-privilege table grants for the application role

Re-applies the (idempotent) Row Level Security statements from app/database/rls.py. The only
change from revision 0008 is that ``meetly_app`` now holds a table privilege ONLY for the commands
that have a policy (for example no DELETE on ``users`` or ``meetings``), instead of all four. A
write RLS would have rejected is now also rejected by a missing privilege. Privileges can only be
REDUCED by this revision; no data and no policy semantics change. PostgreSQL only.

Revision ID: 0011
Revises: 0010
"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    from app.database import rls

    for statement in rls.policy_statements("public"):
        op.execute(statement)


def downgrade() -> None:
    # Re-granting broader privileges would weaken security; there is nothing to undo safely.
    pass
