from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKey, String, Text, false
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base, UTCDateTime, utc_now

JsonType = JSON().with_variant(JSONB(), "postgresql")


class ProfileVisibility(str, enum.Enum):
    PUBLIC = "public"
    FRIENDS = "friends"
    PRIVATE = "private"


class UserProfile(Base):
    """Public-facing identity of a user (1:1 with ``users``).

    Kept apart from ``users`` so identity/auth data (clerk id, email) never
    travels with profile data, and so social features can grow without touching
    the account table. ``username`` is stored lowercase and is unique.
    """

    __tablename__ = "user_profiles"
    __table_args__ = (
        CheckConstraint("length(username) >= 3", name="ck_profiles_username_len"),
        CheckConstraint("username = lower(username)", name="ck_profiles_username_lower"),
        CheckConstraint(
            "visibility IN ('public', 'friends', 'private')", name="ck_profiles_visibility"
        ),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    username: Mapped[str] = mapped_column(String(30), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    # Object key inside the private avatar bucket; never a URL.
    avatar_path: Mapped[str | None] = mapped_column(String(255), default=None)
    bio: Mapped[str | None] = mapped_column(Text, default=None)
    location: Mapped[str | None] = mapped_column(String(100), default=None)
    designation: Mapped[str | None] = mapped_column(String(100), default=None)
    organization: Mapped[str | None] = mapped_column(String(100), default=None)
    website: Mapped[str | None] = mapped_column(String(255), default=None)
    social_links: Mapped[dict | None] = mapped_column(JsonType, default=None)
    visibility: Mapped[str] = mapped_column(
        String(16), default=ProfileVisibility.PUBLIC.value, server_default="public"
    )
    show_meeting_stats: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
