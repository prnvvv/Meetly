from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base, UTCDateTime, utc_now
from app.models.profile import JsonType


class FriendRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class FriendRequest(Base):
    """A request from ``sender_id`` to ``receiver_id``.

    ``pair_low``/``pair_high`` hold the two ids in canonical order so a partial
    unique index can allow only ONE pending request per pair of users, whichever
    direction it was sent in (this is what resolves simultaneous requests).
    """

    __tablename__ = "friend_requests"
    __table_args__ = (
        CheckConstraint("sender_id <> receiver_id", name="ck_friend_requests_not_self"),
        CheckConstraint(
            "status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')",
            name="ck_friend_requests_status",
        ),
        Index(
            "ux_friend_requests_pending_pair",
            "pair_low",
            "pair_high",
            unique=True,
            sqlite_where=text("status = 'PENDING'"),
            postgresql_where=text("status = 'PENDING'"),
        ),
        Index("ix_friend_requests_receiver_status", "receiver_id", "status"),
        Index("ix_friend_requests_sender_status", "sender_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    pair_low: Mapped[int] = mapped_column(Integer)
    pair_high: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default=FriendRequestStatus.PENDING.value)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class Friendship(Base):
    """An accepted friendship, stored once with ids in canonical order (low < high)."""

    __tablename__ = "friendships"
    __table_args__ = (
        CheckConstraint("user_low_id < user_high_id", name="ck_friendships_order"),
        Index("uq_friendships_pair", "user_low_id", "user_high_id", unique=True),
        Index("ix_friendships_high", "user_high_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_low_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    user_high_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class UserBlock(Base):
    __tablename__ = "user_blocks"
    __table_args__ = (
        CheckConstraint("blocker_id <> blocked_id", name="ck_user_blocks_not_self"),
        Index("uq_user_blocks_pair", "blocker_id", "blocked_id", unique=True),
        Index("ix_user_blocks_blocked", "blocked_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class Notification(Base):
    """One in-app notification. ``type`` is an open string so new kinds need no migration."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_recipient_created", "recipient_id", "created_at"),
        Index("ix_notifications_recipient_unread", "recipient_id", "read_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(40))
    entity_type: Mapped[str | None] = mapped_column(String(32), default=None)
    entity_id: Mapped[int | None] = mapped_column(Integer, default=None)
    # Minimal metadata only (e.g. actor_id); display data is looked up when listed.
    payload: Mapped[dict | None] = mapped_column(JsonType, default=None)
    # A retried operation with the same key cannot create a second notification.
    dedupe_key: Mapped[str | None] = mapped_column(String(120), unique=True, default=None)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
