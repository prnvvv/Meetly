from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base, UTCDateTime, utc_now

if TYPE_CHECKING:
    from app.models.meeting_history import MeetingHistory
    from app.models.participant import Participant
    from app.models.user import User


class MeetingStatus(str, enum.Enum):
    """Lifecycle: scheduled -> active -> ended; scheduled -> cancelled.

    Instant meetings are created directly as ``active``.
    """

    SCHEDULED = "scheduled"
    ACTIVE = "active"
    ENDED = "ended"
    CANCELLED = "cancelled"


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        CheckConstraint("duration IS NULL OR duration > 0", name="ck_meetings_duration"),
        CheckConstraint(
            "end_time IS NULL OR end_time >= start_time", name="ck_meetings_time_order"
        ),
        # Upcoming meetings: status = 'scheduled' ORDER BY start_time.
        Index("ix_meetings_status_start_time", "status", "start_time"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Public, user-facing ID (e.g. "839452761"). Never used as a foreign key.
    meeting_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    # Authoritative source of host identity.
    host_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    start_time: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    end_time: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    duration: Mapped[int | None] = mapped_column(Integer, default=None)  # minutes
    # Stored as VARCHAR + CHECK constraint (portable on SQLite), no default:
    # service logic must choose scheduled vs active explicitly.
    status: Mapped[MeetingStatus] = mapped_column(
        Enum(
            MeetingStatus,
            native_enum=False,
            create_constraint=True,
            name="meeting_status",
            length=16,
            values_callable=lambda e: [m.value for m in e],
        ),
        index=True,
    )
    meeting_link: Mapped[str] = mapped_column(String(255), unique=True)
    # Optional meeting password, stored as a bcrypt hash. Never exposed by the API.
    password_hash: Mapped[str | None] = mapped_column(String(255), default=None)
    # JSON object of the host's meeting settings (lockMeeting, waitingRoom, ...).
    settings: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)

    host: Mapped[User] = relationship(
        "User", back_populates="meetings", foreign_keys=[host_id]
    )
    # Participant rows have no meaning without their meeting, so they follow it.
    participants: Mapped[list[Participant]] = relationship(
        "Participant",
        back_populates="meeting",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    # History is preserved: no delete cascade, and the FK is RESTRICT, so a
    # meeting with history cannot be physically deleted. End/cancel instead.
    history: Mapped[MeetingHistory | None] = relationship(
        "MeetingHistory",
        back_populates="meeting",
        uselist=False,
        # Without this the ORM tries to NULL the child foreign key on delete
        # and fails with "NOT NULL constraint failed" instead of surfacing the
        # RESTRICT rule below.
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<Meeting id={self.id} meeting_id={self.meeting_id!r} status={self.status}>"
