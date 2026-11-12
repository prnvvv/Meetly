from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, false, text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base, UTCDateTime

if TYPE_CHECKING:
    from app.models.meeting import Meeting


class Participant(Base):
    """Persistent participant state only; live sockets/WebRTC live in memory."""

    __tablename__ = "participants"
    __table_args__ = (
        CheckConstraint("length(display_name) > 0", name="ck_participants_name"),
        CheckConstraint(
            "left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at",
            name="ck_participants_time_order",
        ),
        # One row per signed-in person per meeting (guests without an account have none).
        Index(
            "uq_participants_meeting_user",
            "meeting_id",
            "user_id",
            unique=True,
            sqlite_where=text("user_id IS NOT NULL"),
            postgresql_where=text("user_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    display_name: Mapped[str] = mapped_column(String(100))
    # Convenience flag only; Meeting.host_id is authoritative.
    is_host: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )
    is_muted: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    is_video_on: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )
    screen_share: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )
    joined_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    left_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="participants")

    def __repr__(self) -> str:
        return f"<Participant id={self.id} name={self.display_name!r}>"
