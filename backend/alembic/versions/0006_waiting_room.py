"""waiting room

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-12 17:08:44.148214
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('waiting_room_entries',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('meeting_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('display_name', sa.String(length=100), nullable=False),
    sa.Column('state', sa.String(length=10), nullable=False),
    sa.Column('decided_by', sa.Integer(), nullable=True),
    sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('admitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("state IN ('WAITING', 'ADMITTED', 'REJECTED', 'JOINED', 'LEFT', 'REMOVED')", name='ck_waiting_room_state'),
    sa.ForeignKeyConstraint(['decided_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('waiting_room_entries', schema=None) as batch_op:
        batch_op.create_index('ix_waiting_room_meeting_state', ['meeting_id', 'state'], unique=False)
        batch_op.create_index('uq_waiting_room_meeting_user', ['meeting_id', 'user_id'], unique=True)

    with op.batch_alter_table('meetings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('waiting_room_enabled', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column('admission_mode', sa.String(length=24), server_default='host_approval', nullable=False))

    # Existing meetings get waiting_room_enabled = false (column default): their
    # admission behaviour is unchanged. The legacy settings.waitingRoom key is not read.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE waiting_room_entries ENABLE ROW LEVEL SECURITY")
        for role in ("anon", "authenticated"):
            op.execute(
                f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                f"THEN REVOKE ALL ON waiting_room_entries FROM {role}; END IF; END $$"
            )


def downgrade() -> None:
    with op.batch_alter_table('meetings', schema=None) as batch_op:
        batch_op.drop_column('admission_mode')
        batch_op.drop_column('waiting_room_enabled')

    with op.batch_alter_table('waiting_room_entries', schema=None) as batch_op:
        batch_op.drop_index('uq_waiting_room_meeting_user')
        batch_op.drop_index('ix_waiting_room_meeting_state')

    op.drop_table('waiting_room_entries')
