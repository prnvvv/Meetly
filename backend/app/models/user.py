from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base, UTCDateTime, utc_now

if TYPE_CHECKING:
    from app.models.meeting import Meeting

DEMO_USER_ID = 1
DEMO_USER_NAME = "Demo User"
DEMO_USER_EMAIL = "demo@example.com"


class User(Base):
    __tablename__ = "users"
    # Same name the additive SQLite migration creates, so both paths agree.
    __table_args__ = (
        Index("uq_users_clerk_id", "clerk_id", unique=True),
        Index(
            "uq_users_email_blind_index",
            "email_blind_index",
            unique=True,
            sqlite_where=text("email_blind_index IS NOT NULL"),
            postgresql_where=text("email_blind_index IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    # Legacy plaintext email. During the encryption roll-out it is dual-written; after the
    # approved cutover it only holds a non-identifying placeholder.
    # Read the address through app.services.account_email, never from this column.
    email: Mapped[str] = mapped_column(String(255), unique=True)
    # AES-256-GCM envelope "enc:v1:<key_version>:<nonce||ciphertext||tag>" (security/crypto.py).
    email_ciphertext: Mapped[str | None] = mapped_column(Text, default=None)
    email_key_version: Mapped[str | None] = mapped_column(String(16), default=None)
    # HMAC-SHA-256 blind index of the normalised email (exact-match lookup and uniqueness).
    email_blind_index: Mapped[str | None] = mapped_column(String(64), default=None)
    email_bidx_version: Mapped[str | None] = mapped_column(String(16), default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    # Clerk user id ("user_..."); NULL for the seeded demo user. Unique index
    # `uq_users_clerk_id` is created by the additive migration.
    clerk_id: Mapped[str | None] = mapped_column(String(255), default=None)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # JSON object: display name, preferred camera/microphone/speaker ids, etc.
    preferences: Mapped[str | None] = mapped_column(Text, default=None)

    # No delete cascade: removing a user must never silently remove meetings.
    meetings: Mapped[list[Meeting]] = relationship(
        "Meeting", back_populates="host", foreign_keys="Meeting.host_id"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id}>"  # never put the email (personal data) in logs
