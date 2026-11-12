"""Friend-to-meeting invitations.

An invitation only records who was asked and notifies them. It never bypasses the
meeting's own rules: the invitee still joins through the normal flow (password,
lock, and later the waiting room). Rules enforced here:

* Inviter must be the host or someone who already took part in the meeting.
* The meeting must be scheduled or active (not ended or cancelled).
* Invitees must be the inviter's friends and not blocked either way; anything else
  is reported as "unavailable" so nothing about the other user is revealed.
* One row per (meeting, invitee). Repeating a request is idempotent; re-inviting after
  a decline, cancel or expiry resets the row and sends one new notification.
* Invitations expire (lazily) when the meeting window passes or after 7 days.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import utc_now
from app.models.meeting import Meeting, MeetingStatus
from app.models.meeting_invitation import InvitationStatus, MeetingInvitation
from app.models.participant import Participant
from app.models.profile import UserProfile
from app.schemas.social import (
    InvitationAcceptResult,
    InvitationMeeting,
    InvitationOut,
    InviteResponse,
    InviteResultItem,
    MeetingInvitationOut,
)
from app.services import notification_service as notes
from app.services import people_service, relationships
from app.services.social_errors import (
    SocialConflict,
    SocialError,
    SocialForbidden,
    SocialNotFound,
)
from app.utils.datetime_utils import has_ended

PENDING = InvitationStatus.PENDING.value
MAX_INVITEES = 50
MAX_LIFETIME = timedelta(days=7)
INSTANT_LIFETIME = timedelta(hours=24)
OPEN_STATUSES = (MeetingStatus.SCHEDULED, MeetingStatus.ACTIVE)
NOTIFY_TYPE = "meeting_invitation"
NOTIFY_ACCEPTED = "meeting_invitation_accepted"


def _expiry_for(meeting: Meeting, now: datetime) -> datetime:
    if meeting.status is MeetingStatus.SCHEDULED:
        window = timedelta(minutes=max(meeting.duration or 60, 60))
        return min(meeting.start_time + window, now + MAX_LIFETIME)
    return now + INSTANT_LIFETIME


def _invite_key(inv: MeetingInvitation) -> str:
    return f"meeting_invitation:{inv.id}:{int(inv.sent_at.timestamp())}"


def _accepted_key(inv: MeetingInvitation) -> str:
    return f"meeting_invitation_accepted:{inv.id}"


def _effective(inv: MeetingInvitation, now: datetime) -> str:
    if inv.status == PENDING and inv.expires_at <= now:
        return InvitationStatus.EXPIRED.value
    return inv.status


def _meeting_by_public_id(db: Session, public_id: str) -> Meeting:
    meeting = db.scalars(select(Meeting).where(Meeting.meeting_id == public_id)).first()
    if meeting is None:
        raise SocialNotFound("Meeting not found")
    return meeting


def _may_invite(db: Session, meeting: Meeting, user_id: int) -> bool:
    if meeting.host_id == user_id:
        return True
    return (
        db.scalar(
            select(Participant.id).where(
                Participant.meeting_id == meeting.id, Participant.user_id == user_id
            )
        )
        is not None
    )


def _meeting_open(meeting: Meeting) -> bool:
    return meeting.status in OPEN_STATUSES and not (
        meeting.status is MeetingStatus.ACTIVE and has_ended(meeting)
    )


def invite(
    db: Session, inviter_id: int, public_meeting_id: str, user_ids: list[int]
) -> tuple[InviteResponse, set[int]]:
    meeting = _meeting_by_public_id(db, public_meeting_id)
    if not _may_invite(db, meeting, inviter_id):
        # Not revealing whether the meeting exists to outsiders.
        raise SocialNotFound("Meeting not found")
    if not _meeting_open(meeting):
        raise SocialConflict("This meeting has ended or was cancelled")
    ids = list(dict.fromkeys(user_ids))
    if not ids or len(ids) > MAX_INVITEES:
        raise SocialError(f"Invite between 1 and {MAX_INVITEES} people at a time")

    friends = relationships.friend_ids(db, inviter_id)
    blocked = relationships.blocked_ids_either_way(db, inviter_id)
    now = utc_now()
    touched: set[int] = set()
    results: list[InviteResultItem] = []
    invited = 0

    existing = {
        inv.invitee_id: inv
        for inv in db.scalars(
            select(MeetingInvitation).where(
                MeetingInvitation.meeting_id == meeting.id, MeetingInvitation.invitee_id.in_(ids)
            )
        )
    }
    for uid in ids:
        if uid == inviter_id or uid == meeting.host_id or uid not in friends or uid in blocked:
            results.append(InviteResultItem(user_id=uid, result="unavailable"))
            continue
        inv = existing.get(uid)
        if inv is not None:
            state = _effective(inv, now)
            if state in (InvitationStatus.PENDING.value, InvitationStatus.ACCEPTED.value):
                results.append(InviteResultItem(user_id=uid, result="already_invited"))
                continue
            inv.status = PENDING  # declined / cancelled / expired: ask again
            inv.inviter_id = inviter_id
            inv.sent_at = now
            inv.expires_at = _expiry_for(meeting, now)
            inv.responded_at = None
            db.flush()
            result = "reinvited"
        else:
            inv = MeetingInvitation(
                meeting_id=meeting.id,
                invitee_id=uid,
                inviter_id=inviter_id,
                sent_at=now,
                expires_at=_expiry_for(meeting, now),
            )
            try:
                with db.begin_nested():
                    db.add(inv)
            except IntegrityError:  # a concurrent request invited them first
                results.append(InviteResultItem(user_id=uid, result="already_invited"))
                continue
            result = "invited"
        note = notes.create(
            db,
            uid,
            NOTIFY_TYPE,
            entity_type="meeting_invitation",
            entity_id=inv.id,
            payload={"actor_id": inviter_id, "meeting_id": meeting.meeting_id, "title": meeting.title},
            dedupe_key=_invite_key(inv),
            ttl=inv.expires_at - now,
        )
        if note:
            touched.add(uid)
        results.append(InviteResultItem(user_id=uid, result=result))
        invited += 1
    db.commit()
    return InviteResponse(meeting_id=meeting.meeting_id, results=results, invited=invited), touched


def _get_for_invitee(db: Session, user_id: int, invitation_id: int) -> MeetingInvitation:
    inv = db.get(MeetingInvitation, invitation_id)
    if inv is None or inv.invitee_id != user_id:
        raise SocialNotFound("Invitation not found")
    return inv


def _expire(db: Session, inv: MeetingInvitation) -> None:
    inv.status = InvitationStatus.EXPIRED.value
    inv.responded_at = utc_now()
    notes.delete_by_dedupe_key(db, _invite_key(inv))
    db.commit()


def accept(db: Session, user_id: int, invitation_id: int) -> tuple[InvitationAcceptResult, set[int]]:
    inv = _get_for_invitee(db, user_id, invitation_id)
    meeting = db.get(Meeting, inv.meeting_id)
    assert meeting is not None
    out = lambda: InvitationAcceptResult(  # noqa: E731
        invitation_id=inv.id,
        status=inv.status,
        meeting_id=meeting.meeting_id,
        has_password=meeting.password_hash is not None,
        joinable_now=meeting.status is MeetingStatus.ACTIVE,
    )
    if inv.status == InvitationStatus.ACCEPTED.value:
        return out(), set()
    if _effective(inv, utc_now()) == InvitationStatus.EXPIRED.value and inv.status == PENDING:
        _expire(db, inv)
        raise SocialConflict("This invitation has expired")
    if inv.status != PENDING:
        raise SocialConflict(f"This invitation was {inv.status.lower()}")
    if not _meeting_open(meeting):
        _expire(db, inv)
        raise SocialConflict("This meeting has ended or was cancelled")
    if relationships.is_blocked_either_way(db, inv.inviter_id, user_id):
        raise SocialForbidden("This invitation is no longer available")
    inv.status = InvitationStatus.ACCEPTED.value
    inv.responded_at = utc_now()
    touched = set(notes.delete_by_dedupe_key(db, _invite_key(inv)))
    note = notes.create(
        db,
        inv.inviter_id,
        NOTIFY_ACCEPTED,
        entity_type="meeting_invitation",
        entity_id=inv.id,
        payload={"actor_id": user_id, "meeting_id": meeting.meeting_id, "title": meeting.title},
        dedupe_key=_accepted_key(inv),
    )
    if note:
        touched.add(inv.inviter_id)
    db.commit()
    return out(), touched | {user_id}


def decline(db: Session, user_id: int, invitation_id: int) -> tuple[InvitationAcceptResult, set[int]]:
    inv = _get_for_invitee(db, user_id, invitation_id)
    meeting = db.get(Meeting, inv.meeting_id)
    assert meeting is not None
    if inv.status == InvitationStatus.DECLINED.value:
        pass
    elif inv.status != PENDING:
        raise SocialConflict(f"This invitation was {inv.status.lower()}")
    else:
        inv.status = InvitationStatus.DECLINED.value  # silent: the inviter is not notified
        inv.responded_at = utc_now()
        touched = set(notes.delete_by_dedupe_key(db, _invite_key(inv)))
        db.commit()
        return (
            InvitationAcceptResult(
                invitation_id=inv.id, status=inv.status, meeting_id=meeting.meeting_id,
                has_password=meeting.password_hash is not None, joinable_now=False,
            ),
            touched,
        )
    return (
        InvitationAcceptResult(
            invitation_id=inv.id, status=inv.status, meeting_id=meeting.meeting_id,
            has_password=meeting.password_hash is not None, joinable_now=False,
        ),
        set(),
    )


def cancel(db: Session, user_id: int, invitation_id: int) -> set[int]:
    """The inviter or the meeting host withdraws a pending invitation."""
    inv = db.get(MeetingInvitation, invitation_id)
    meeting = db.get(Meeting, inv.meeting_id) if inv else None
    if inv is None or meeting is None or user_id not in (inv.inviter_id, meeting.host_id):
        raise SocialNotFound("Invitation not found")
    if inv.status == InvitationStatus.CANCELLED.value:
        return set()
    if inv.status != PENDING:
        raise SocialConflict(f"This invitation was {inv.status.lower()}")
    inv.status = InvitationStatus.CANCELLED.value
    inv.responded_at = utc_now()
    touched = set(notes.delete_by_dedupe_key(db, _invite_key(inv)))
    db.commit()
    return touched


def cancel_pending_between(db: Session, a: int, b: int) -> set[int]:
    """Used when blocking: withdraw pending invitations either way (caller commits)."""
    touched: set[int] = set()
    rows = db.scalars(
        select(MeetingInvitation).where(
            MeetingInvitation.status == PENDING,
            or_(
                and_(MeetingInvitation.inviter_id == a, MeetingInvitation.invitee_id == b),
                and_(MeetingInvitation.inviter_id == b, MeetingInvitation.invitee_id == a),
            ),
        )
    ).all()
    for inv in rows:
        inv.status = InvitationStatus.CANCELLED.value
        inv.responded_at = utc_now()
        touched |= set(notes.delete_by_dedupe_key(db, _invite_key(inv)))
    return touched


def list_received(db: Session, user_id: int, *, pending_only: bool = True, limit: int = 50) -> list[InvitationOut]:
    stmt = select(MeetingInvitation).where(MeetingInvitation.invitee_id == user_id)
    if pending_only:
        stmt = stmt.where(MeetingInvitation.status == PENDING, MeetingInvitation.expires_at > utc_now())
    rows = list(db.scalars(stmt.order_by(MeetingInvitation.id.desc()).limit(limit)))
    hidden = relationships.blocked_ids_either_way(db, user_id)
    rows = [r for r in rows if r.inviter_id not in hidden]
    meetings = {m.id: m for m in db.scalars(select(Meeting).where(Meeting.id.in_({r.meeting_id for r in rows})))} if rows else {}
    profiles = {
        p.user_id: p
        for p in db.scalars(select(UserProfile).where(UserProfile.user_id.in_({r.inviter_id for r in rows})))
    } if rows else {}
    cards = {c.user_id: c for c in people_service.cards(db, user_id, list(profiles.values()))}
    now = utc_now()
    out: list[InvitationOut] = []
    for r in rows:
        m = meetings.get(r.meeting_id)
        card = cards.get(r.inviter_id)
        if m is None or card is None:
            continue
        out.append(
            InvitationOut(
                id=r.id,
                status=_effective(r, now),
                created_at=r.sent_at,
                expires_at=r.expires_at,
                inviter=card,
                meeting=InvitationMeeting(
                    meeting_id=m.meeting_id,
                    title=m.title,
                    start_time=m.start_time,
                    status=m.status.value,
                    has_password=m.password_hash is not None,
                ),
            )
        )
    return out


def list_for_meeting(db: Session, user_id: int, public_meeting_id: str) -> list[MeetingInvitationOut]:
    meeting = _meeting_by_public_id(db, public_meeting_id)
    if not _may_invite(db, meeting, user_id):
        raise SocialNotFound("Meeting not found")
    stmt = select(MeetingInvitation).where(MeetingInvitation.meeting_id == meeting.id)
    if meeting.host_id != user_id:
        stmt = stmt.where(MeetingInvitation.inviter_id == user_id)  # participants see only their own
    rows = list(db.scalars(stmt.order_by(MeetingInvitation.id.desc()).limit(200)))
    hidden = relationships.blocked_ids_either_way(db, user_id)
    rows = [r for r in rows if r.invitee_id not in hidden]
    profiles = list(db.scalars(select(UserProfile).where(UserProfile.user_id.in_({r.invitee_id for r in rows})))) if rows else []
    cards = {c.user_id: c for c in people_service.cards(db, user_id, profiles)}
    now = utc_now()
    return [
        MeetingInvitationOut(
            id=r.id, status=_effective(r, now), created_at=r.sent_at,
            responded_at=r.responded_at, person=cards[r.invitee_id],
        )
        for r in rows
        if r.invitee_id in cards
    ]
