"""email encryption columns (expand step)

Adds NULLABLE columns for the encrypted email and its blind index, and a partial unique index
on the blind index. Purely additive: the plaintext column and every existing row are untouched.
The backfill is a separate, resumable data script (scripts/backfill_email_encryption.py); the
plaintext is only scrubbed later, in a separate approved step.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-12 18:45:58.031206
"""
from alembic import op
import sqlalchemy as sa


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('email_ciphertext', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('email_key_version', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('email_blind_index', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('email_bidx_version', sa.String(length=16), nullable=True))
        batch_op.create_index('uq_users_email_blind_index', ['email_blind_index'], unique=True, sqlite_where=sa.text('email_blind_index IS NOT NULL'), postgresql_where=sa.text('email_blind_index IS NOT NULL'))



def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index('uq_users_email_blind_index', sqlite_where=sa.text('email_blind_index IS NOT NULL'), postgresql_where=sa.text('email_blind_index IS NOT NULL'))
        batch_op.drop_column('email_bidx_version')
        batch_op.drop_column('email_blind_index')
        batch_op.drop_column('email_key_version')
        batch_op.drop_column('email_ciphertext')

