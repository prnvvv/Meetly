"""social graph and notifications

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-12 16:29:33.002958
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('friend_requests',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('sender_id', sa.Integer(), nullable=False),
    sa.Column('receiver_id', sa.Integer(), nullable=False),
    sa.Column('pair_low', sa.Integer(), nullable=False),
    sa.Column('pair_high', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')", name='ck_friend_requests_status'),
    sa.CheckConstraint('sender_id <> receiver_id', name='ck_friend_requests_not_self'),
    sa.ForeignKeyConstraint(['receiver_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('friend_requests', schema=None) as batch_op:
        batch_op.create_index('ix_friend_requests_receiver_status', ['receiver_id', 'status'], unique=False)
        batch_op.create_index('ix_friend_requests_sender_status', ['sender_id', 'status'], unique=False)
        batch_op.create_index('ux_friend_requests_pending_pair', ['pair_low', 'pair_high'], unique=True, sqlite_where=sa.text("status = 'PENDING'"), postgresql_where=sa.text("status = 'PENDING'"))

    op.create_table('friendships',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_low_id', sa.Integer(), nullable=False),
    sa.Column('user_high_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('user_low_id < user_high_id', name='ck_friendships_order'),
    sa.ForeignKeyConstraint(['user_high_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_low_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('friendships', schema=None) as batch_op:
        batch_op.create_index('ix_friendships_high', ['user_high_id'], unique=False)
        batch_op.create_index('uq_friendships_pair', ['user_low_id', 'user_high_id'], unique=True)

    op.create_table('notifications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('recipient_id', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=40), nullable=False),
    sa.Column('entity_type', sa.String(length=32), nullable=True),
    sa.Column('entity_id', sa.Integer(), nullable=True),
    sa.Column('payload', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'), nullable=True),
    sa.Column('dedupe_key', sa.String(length=120), nullable=True),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('dedupe_key')
    )
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.create_index('ix_notifications_recipient_created', ['recipient_id', 'created_at'], unique=False)
        batch_op.create_index('ix_notifications_recipient_unread', ['recipient_id', 'read_at'], unique=False)

    op.create_table('user_blocks',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('blocker_id', sa.Integer(), nullable=False),
    sa.Column('blocked_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('blocker_id <> blocked_id', name='ck_user_blocks_not_self'),
    sa.ForeignKeyConstraint(['blocked_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['blocker_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('user_blocks', schema=None) as batch_op:
        batch_op.create_index('ix_user_blocks_blocked', ['blocked_id'], unique=False)
        batch_op.create_index('uq_user_blocks_pair', ['blocker_id', 'blocked_id'], unique=True)

    if op.get_bind().dialect.name == "postgresql":
        # Same lock-down as 0002/0003: RLS on, no browser-role privileges.
        for table in ("friend_requests", "friendships", "notifications", "user_blocks"):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            for role in ("anon", "authenticated"):
                op.execute(
                    f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                    f"THEN REVOKE ALL ON {table} FROM {role}; END IF; END $$"
                )


def downgrade() -> None:
    with op.batch_alter_table('user_blocks', schema=None) as batch_op:
        batch_op.drop_index('uq_user_blocks_pair')
        batch_op.drop_index('ix_user_blocks_blocked')

    op.drop_table('user_blocks')
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_index('ix_notifications_recipient_unread')
        batch_op.drop_index('ix_notifications_recipient_created')

    op.drop_table('notifications')
    with op.batch_alter_table('friendships', schema=None) as batch_op:
        batch_op.drop_index('uq_friendships_pair')
        batch_op.drop_index('ix_friendships_high')

    op.drop_table('friendships')
    with op.batch_alter_table('friend_requests', schema=None) as batch_op:
        batch_op.drop_index('ux_friend_requests_pending_pair', sqlite_where=sa.text("status = 'PENDING'"), postgresql_where=sa.text("status = 'PENDING'"))
        batch_op.drop_index('ix_friend_requests_sender_status')
        batch_op.drop_index('ix_friend_requests_receiver_status')

    op.drop_table('friend_requests')
