"""Friend request lifecycle and friendships.

Lifecycle: PENDING -> ACCEPTED | REJECTED | CANCELLED (terminal). Only the receiver
may accept/reject; only the sender may cancel. Every mutation runs in one
transaction. Functions return the user ids whose notification feed changed so the
router can push a realtime hint after the commit.

Simultaneous requests: a partial unique index allows one PENDING row per pair of
users in either direction. If A and B send at the same moment, one insert wins and
the other detects the winner and accepts it, so the result is exactly one
friendship and no duplicate rows. Sending to someone who already requested you
also accepts that request.

Policy choices (documented in SOCIAL_NETWORKING_ARCHITECTURE.md):
* Rejections are silent (the sender is not notified); a rejected sender cannot
  re-request the same person for 7 days.
* Cancelling removes the receiver notification.
* Private profiles and blocked users cannot be requested (reported as not found).
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import utc_now
from app.models.profile import UserProfile
from app.models.social import FriendRequest, FriendRequestStatus, Friendship
from app.schemas.social import FriendRequestOut, FriendRequestResult, PersonPage
from app.services import notification_service as notes
from app.services import people_service, profile_service, relationships
from app.services.relationships import canonical_pair
from app.services.social_errors import (
    SocialConflict,
    SocialError,
    SocialForbidden,
    SocialNotFound,
    SocialTooSoon,
)

PENDING = FriendRequestStatus.PENDING.value
REJECT_COOLDOWN = timedelta(days=7)


def _request_key(request_id: int) -> str:
    return f"friend_request:{request_id}"


def _accepted_key(request_id: int) -> str:
    return f"friend_request_accepted:{request_id}"


def _make_friends(db: Session, a: int, b: int) -> bool:
    low, high = canonical_pair(a, b)
    try:
        with db.begin_nested():
            db.add(Friendship(user_low_id=low, user_high_id=high))
        return True
    except IntegrityError:
        return False  # already friends: idempotent


def _pending_for_pair(db: Session, a: int, b: int) -> FriendRequest | None:
    low, high = canonical_pair(a, b)
    return db.scalars(
        select(FriendRequest).where(
            FriendRequest.pair_low == low,
            FriendRequest.pair_high == high,
            FriendRequest.status == PENDING,
        )
    ).first()


def _accept_row(db: Session, req: FriendRequest) -> tuple[bool, set[int]]:
    now = utc_now()
    req.status = FriendRequestStatus.ACCEPTED.value
    req.responded_at = now
    created = _make_friends(db, req.sender_id, req.receiver_id)
    touched = set(notes.delete_by_dedupe_key(db, _request_key(req.id)))
    note = notes.create(
        db,
        req.sender_id,
        notes.FRIEND_REQUEST_ACCEPTED,
        entity_type="friend_request",
        entity_id=req.id,
        payload={"actor_id": req.receiver_id},
        dedupe_key=_accepted_key(req.id),
    )
    if note:
        touched.add(req.sender_id)
    touched.add(req.receiver_id)
    return created, touched


def send_request(db: Session, sender_id: int, receiver_id: int) -> tuple[FriendRequestResult, set[int]]:
    if sender_id == receiver_id:
        raise SocialError("You cannot send a friend request to yourself")
    target = db.get(UserProfile, receiver_id)
    rel = relationships.relation(db, sender_id, receiver_id)
    if target is None or rel.blocked or target.visibility == "private":
        # Same answer for missing, blocked and private: nothing is revealed.
        raise SocialNotFound("User not found")
    if rel.is_friend:
        raise SocialConflict("You are already friends")

    for _ in range(3):  # a lost race re-reads the winner
        existing = _pending_for_pair(db, sender_id, receiver_id)
        if existing is not None:
            if existing.sender_id == sender_id:
                return FriendRequestResult(request_id=existing.id, status=existing.status, friendship_created=False), set()
            created, touched = _accept_row(db, existing)
            db.commit()
            return FriendRequestResult(request_id=existing.id, status=existing.status, friendship_created=created), touched

        last_rejected = db.scalar(
            select(func.max(FriendRequest.responded_at)).where(
                FriendRequest.sender_id == sender_id,
                FriendRequest.receiver_id == receiver_id,
                FriendRequest.status == FriendRequestStatus.REJECTED.value,
            )
        )
        if last_rejected is not None and utc_now() - last_rejected < REJECT_COOLDOWN:
            raise SocialTooSoon("You cannot send this person another request yet")

        low, high = canonical_pair(sender_id, receiver_id)
        req = FriendRequest(sender_id=sender_id, receiver_id=receiver_id, pair_low=low, pair_high=high)
        try:
            with db.begin_nested():
                db.add(req)
        except IntegrityError:
            continue
        note = notes.create(
            db,
            receiver_id,
            notes.FRIEND_REQUEST,
            entity_type="friend_request",
            entity_id=req.id,
            payload={"actor_id": sender_id},
            dedupe_key=_request_key(req.id),
        )
        db.commit()
        return (
            FriendRequestResult(request_id=req.id, status=req.status, friendship_created=False),
            {receiver_id} if note else set(),
        )
    raise SocialConflict("Could not send the request, please try again")


def _get_request(db: Session, request_id: int) -> FriendRequest | None:
    return db.get(FriendRequest, request_id)


def accept(db: Session, user_id: int, request_id: int) -> tuple[FriendRequestResult, set[int]]:
    req = _get_request(db, request_id)
    if req is None or req.receiver_id != user_id:
        raise SocialNotFound("Request not found")
    if req.status == FriendRequestStatus.ACCEPTED.value:
        return FriendRequestResult(request_id=req.id, status=req.status, friendship_created=False), set()
    if req.status != PENDING:
        raise SocialConflict(f"This request was already {req.status.lower()}")
    if relationships.is_blocked_either_way(db, req.sender_id, req.receiver_id):
        raise SocialForbidden("This request can no longer be accepted")
    created, touched = _accept_row(db, req)
    db.commit()
    return FriendRequestResult(request_id=req.id, status=req.status, friendship_created=created), touched


def reject(db: Session, user_id: int, request_id: int) -> tuple[FriendRequestResult, set[int]]:
    req = _get_request(db, request_id)
    if req is None or req.receiver_id != user_id:
        raise SocialNotFound("Request not found")
    if req.status == FriendRequestStatus.REJECTED.value:
        return FriendRequestResult(request_id=req.id, status=req.status, friendship_created=False), set()
    if req.status != PENDING:
        raise SocialConflict(f"This request was already {req.status.lower()}")
    req.status = FriendRequestStatus.REJECTED.value
    req.responded_at = utc_now()
    touched = set(notes.delete_by_dedupe_key(db, _request_key(req.id)))
    db.commit()
    return FriendRequestResult(request_id=req.id, status=req.status, friendship_created=False), touched


def cancel(db: Session, user_id: int, request_id: int) -> tuple[FriendRequestResult, set[int]]:
    req = _get_request(db, request_id)
    if req is None or req.sender_id != user_id:
        raise SocialNotFound("Request not found")
    if req.status == FriendRequestStatus.CANCELLED.value:
        return FriendRequestResult(request_id=req.id, status=req.status, friendship_created=False), set()
    if req.status != PENDING:
        raise SocialConflict(f"This request was already {req.status.lower()}")
    req.status = FriendRequestStatus.CANCELLED.value
    req.responded_at = utc_now()
    touched = set(notes.delete_by_dedupe_key(db, _request_key(req.id)))
    db.commit()
    return FriendRequestResult(request_id=req.id, status=req.status, friendship_created=False), touched


def cancel_pending_between(db: Session, a: int, b: int) -> set[int]:
    """Used when blocking: drop any pending request in either direction (no commit)."""
    touched: set[int] = set()
    req = _pending_for_pair(db, a, b)
    if req is not None:
        req.status = FriendRequestStatus.CANCELLED.value
        req.responded_at = utc_now()
        touched |= set(notes.delete_by_dedupe_key(db, _request_key(req.id)))
    return touched


def remove_friend(db: Session, user_id: int, friend_id: int) -> None:
    low, high = canonical_pair(user_id, friend_id)
    row = db.scalars(
        select(Friendship).where(Friendship.user_low_id == low, Friendship.user_high_id == high)
    ).first()
    if row is None:
        raise SocialNotFound("Friend not found")
    db.delete(row)
    db.commit()


def delete_friendship_between(db: Session, a: int, b: int) -> None:
    low, high = canonical_pair(a, b)
    row = db.scalars(
        select(Friendship).where(Friendship.user_low_id == low, Friendship.user_high_id == high)
    ).first()
    if row is not None:
        db.delete(row)


def list_friends(db: Session, user_id: int, *, q: str = "", limit: int = 20, offset: int = 0) -> PersonPage:
    limit = max(1, min(limit, people_service.MAX_LIMIT))
    friend_ids = relationships.friend_ids(db, user_id)
    if not friend_ids:
        return PersonPage(items=[], has_more=False)
    stmt = select(UserProfile).where(UserProfile.user_id.in_(friend_ids))
    needle = q.strip().lower()
    if needle:
        like = people_service._escape_like(needle)
        stmt = stmt.where(
            or_(
                UserProfile.username.like(f"{like}%", escape="\\"),
                func.lower(UserProfile.display_name).like(f"%{like}%", escape="\\"),
            )
        )
    rows = list(db.scalars(stmt.order_by(func.lower(UserProfile.display_name), UserProfile.user_id).limit(limit + 1).offset(max(0, offset))))
    return PersonPage(
        items=people_service.cards(db, user_id, rows[:limit], friends=friend_ids),
        has_more=len(rows) > limit,
    )


def list_requests(db: Session, user_id: int, *, incoming: bool) -> list[FriendRequestOut]:
    col = FriendRequest.receiver_id if incoming else FriendRequest.sender_id
    reqs = list(
        db.scalars(
            select(FriendRequest)
            .where(col == user_id, FriendRequest.status == PENDING)
            .order_by(FriendRequest.id.desc())
            .limit(100)
        )
    )
    other_ids = [r.sender_id if incoming else r.receiver_id for r in reqs]
    hidden = relationships.blocked_ids_either_way(db, user_id)
    profiles = {
        p.user_id: p for p in db.scalars(select(UserProfile).where(UserProfile.user_id.in_(other_ids)))
    } if other_ids else {}
    ordered = [profiles[i] for i in other_ids if i in profiles and i not in hidden]
    card_by_id = {c.user_id: c for c in people_service.cards(db, user_id, ordered)}
    out: list[FriendRequestOut] = []
    for r, other in zip(reqs, other_ids):
        if other in card_by_id:
            out.append(
                FriendRequestOut(
                    id=r.id,
                    status=r.status,
                    created_at=r.created_at,
                    responded_at=r.responded_at,
                    person=card_by_id[other],
                )
            )
    return out


__all__ = ["profile_service"]
