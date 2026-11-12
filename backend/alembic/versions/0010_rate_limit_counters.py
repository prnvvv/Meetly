"""rate limit counters (shared fixed-window store for multi-instance limiting)

Additive new table; nothing existing is touched. Used only when RATE_LIMIT_BACKEND=database.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-12 19:13:45.876024
"""
from alembic import op
import sqlalchemy as sa


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('rate_limit_counters',
    sa.Column('bucket', sa.String(length=64), nullable=False),
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('window_start', sa.BigInteger(), nullable=False),
    sa.Column('hits', sa.Integer(), nullable=False),
    sa.Column('expires_at', sa.BigInteger(), nullable=False),
    sa.PrimaryKeyConstraint('bucket', 'key', 'window_start')
    )
    with op.batch_alter_table('rate_limit_counters', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_rate_limit_counters_expires_at'), ['expires_at'], unique=False)

    if op.get_bind().dialect.name == "postgresql":
        # Operational table used by the owner login only: RLS on, no grant for meetly_app, none for the browser roles.
        op.execute("ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY")
        for role in ("anon", "authenticated"):
            op.execute(
                f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                f"THEN REVOKE ALL ON rate_limit_counters FROM {role}; END IF; END $$"
            )



def downgrade() -> None:
    with op.batch_alter_table('rate_limit_counters', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_rate_limit_counters_expires_at'))

    op.drop_table('rate_limit_counters')
