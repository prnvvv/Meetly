from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base, UTCDateTime, utc_now


class Invitation(Base):
    """Someone the host invited to a meeting.

    No message is delivered by this row: Meetly has no email provider, so an
    invitation records who was invited and the host shares the meeting link
    themselves. ``invitee_ref`` is whatever identifies the invitee in the UI
    (a contact id today, an email once one exists).
    """

    __tablename__ = "invitations"
    __table_args__ = (
        Index("uq_invitations_meeting_invitee", "meeting_id", "invitee_ref", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    inviter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    invitee_ref: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
