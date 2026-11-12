"""meeting invitations

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-12 16:58:32.409390
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('meeting_invitations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('meeting_id', sa.Integer(), nullable=False),
    sa.Column('inviter_id', sa.Integer(), nullable=False),
    sa.Column('invitee_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')", name='ck_meeting_invitations_status'),
    sa.CheckConstraint('inviter_id <> invitee_id', name='ck_meeting_invitations_not_self'),
    sa.ForeignKeyConstraint(['invitee_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['inviter_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('meeting_invitations', schema=None) as batch_op:
        batch_op.create_index('ix_meeting_invitations_invitee_status', ['invitee_id', 'status'], unique=False)
        batch_op.create_index('ix_meeting_invitations_inviter', ['inviter_id'], unique=False)
        batch_op.create_index('uq_meeting_invitations_pair', ['meeting_id', 'invitee_id'], unique=True)

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE meeting_invitations ENABLE ROW LEVEL SECURITY")
        for role in ("anon", "authenticated"):
            op.execute(
                f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                f"THEN REVOKE ALL ON meeting_invitations FROM {role}; END IF; END $$"
            )


def downgrade() -> None:
    with op.batch_alter_table('meeting_invitations', schema=None) as batch_op:
        batch_op.drop_index('uq_meeting_invitations_pair')
        batch_op.drop_index('ix_meeting_invitations_inviter')
        batch_op.drop_index('ix_meeting_invitations_invitee_status')

    op.drop_table('meeting_invitations')
