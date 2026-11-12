from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base, UTCDateTime, utc_now


class InvitationStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


class MeetingInvitation(Base):
    """A user-to-user invitation to a meeting (replaces the unused free-text ``invitations``).

    An invitation grants nothing by itself: the invitee still goes through the normal
    join flow (password, lock, waiting room). ``sent_at`` changes on every re-invite so
    the notification dedupe key stays unique per send but stable under retries.
    """

    __tablename__ = "meeting_invitations"
    __table_args__ = (
        CheckConstraint("inviter_id <> invitee_id", name="ck_meeting_invitations_not_self"),
        CheckConstraint(
            "status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')",
            name="ck_meeting_invitations_status",
        ),
        Index("uq_meeting_invitations_pair", "meeting_id", "invitee_id", unique=True),
        Index("ix_meeting_invitations_invitee_status", "invitee_id", "status"),
        Index("ix_meeting_invitations_inviter", "inviter_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"))
    inviter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    invitee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(12), default=InvitationStatus.PENDING.value)
    sent_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
