"""user profiles

Adds ``user_profiles`` (1:1 with users) and backfills one row per existing user
with a neutral generated username (``user<id>``) and the user's current name.
Existing data is only read, never changed.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
    op.create_table(
        "user_profiles",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=30), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("avatar_path", sa.String(length=255), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("location", sa.String(length=100), nullable=True),
        sa.Column("designation", sa.String(length=100), nullable=True),
        sa.Column("organization", sa.String(length=100), nullable=True),
        sa.Column("website", sa.String(length=255), nullable=True),
        sa.Column("social_links", json_type, nullable=True),
        sa.Column("visibility", sa.String(length=16), server_default="public", nullable=False),
        sa.Column("show_meeting_stats", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(username) >= 3", name="ck_profiles_username_len"),
        sa.CheckConstraint("username = lower(username)", name="ck_profiles_username_lower"),
        sa.CheckConstraint(
            "visibility IN ('public', 'friends', 'private')", name="ck_profiles_visibility"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
        sa.UniqueConstraint("username"),
    )
    op.execute(
        """
        INSERT INTO user_profiles (user_id, username, display_name, visibility,
                                   show_meeting_stats, created_at, updated_at)
        SELECT id, 'user' || CAST(id AS VARCHAR(20)), name, 'public', %s,
               created_at, created_at
        FROM users
        """
        % ("false" if op.get_bind().dialect.name == "postgresql" else "0")
    )
    if op.get_bind().dialect.name == "postgresql":
        # Same lock-down as 0002 for the new table (belt and braces with RLS).
        op.execute("ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY")
        for role in ("anon", "authenticated"):
            op.execute(
                f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                f"THEN REVOKE ALL ON user_profiles FROM {role}; END IF; END $$"
            )


def downgrade() -> None:
    op.drop_table("user_profiles")
