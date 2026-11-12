"""one participant row per user per meeting

Adds a partial unique index on participants(meeting_id, user_id) WHERE user_id IS NOT
NULL, closing a check-then-insert race that could create two rows for one person.

Existing data is never modified. If duplicate pairs already exist the index is NOT
created (merging participant history is a human decision); the migration logs the
offending pairs and the CREATE UNIQUE INDEX statement to run once they are resolved.

Revision ID: 0007
Revises: 0006
"""
import logging

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    bind = op.get_bind()
    dupes = bind.execute(
        sa.text(
            "SELECT meeting_id, user_id, COUNT(*) FROM participants "
            "WHERE user_id IS NOT NULL GROUP BY meeting_id, user_id HAVING COUNT(*) > 1"
        )
    ).fetchall()
    if dupes:
        log.warning(
            "participants has %d duplicate (meeting_id, user_id) pairs, e.g. %s; "
            "uq_participants_meeting_user NOT created. Resolve them, then run: "
            "CREATE UNIQUE INDEX uq_participants_meeting_user ON participants "
            "(meeting_id, user_id) WHERE user_id IS NOT NULL",
            len(dupes),
            [tuple(r[:2]) for r in dupes[:5]],
        )
        return
    op.create_index(
        "uq_participants_meeting_user",
        "participants",
        ["meeting_id", "user_id"],
        unique=True,
        sqlite_where=sa.text("user_id IS NOT NULL"),
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_participants_meeting_user")
