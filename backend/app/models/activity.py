from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base, UTCDateTime, utc_now


class ActivityEvent(Base):
    """Small audit trail of important meeting actions (no message or media content)."""

    __tablename__ = "activity_events"
    __table_args__ = (Index("ix_activity_meeting_time", "meeting_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"))
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    kind: Mapped[str] = mapped_column(String(32))
    detail: Mapped[str | None] = mapped_column(String(255), default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
