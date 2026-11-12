from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base, UTCDateTime, utc_now


class WaitingState(str, enum.Enum):
    WAITING = "WAITING"
    ADMITTED = "ADMITTED"
    REJECTED = "REJECTED"
    JOINED = "JOINED"
    LEFT = "LEFT"
    REMOVED = "REMOVED"


class WaitingRoomEntry(Base):
    """Durable admission state of one user in one meeting.

    Only business state lives here (who is waiting, who was let in or turned away).
    Live socket state (who is connected right now) stays in memory and is rebuilt as
    clients reconnect. ``admitted_at`` records that the host let this person in.
    """

    __tablename__ = "waiting_room_entries"
    __table_args__ = (
        CheckConstraint(
            "state IN ('WAITING', 'ADMITTED', 'REJECTED', 'JOINED', 'LEFT', 'REMOVED')",
            name="ck_waiting_room_state",
        ),
        Index("uq_waiting_room_meeting_user", "meeting_id", "user_id", unique=True),
        Index("ix_waiting_room_meeting_state", "meeting_id", "state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    display_name: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(10), default=WaitingState.WAITING.value)
    decided_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    requested_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    admitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
