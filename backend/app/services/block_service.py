"""Blocking.

Policy: blocking removes any friendship and cancels pending requests between the two
users, hides each from the other in search/profiles/notifications, and prevents new
requests and invitations. It does NOT eject anyone from a meeting they are already
in; the host controls who stays in a live meeting.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.profile import UserProfile
from app.models.social import UserBlock
from app.schemas.social import PersonPage
from app.services import friend_service, invitation_service, people_service
from app.services.social_errors import SocialError, SocialNotFound


def block(db: Session, blocker_id: int, target_id: int) -> set[int]:
    if blocker_id == target_id:
        raise SocialError("You cannot block yourself")
    if db.get(UserProfile, target_id) is None:
        raise SocialNotFound("User not found")
    touched = friend_service.cancel_pending_between(db, blocker_id, target_id)
    touched |= invitation_service.cancel_pending_between(db, blocker_id, target_id)
    friend_service.delete_friendship_between(db, blocker_id, target_id)
    try:
        with db.begin_nested():
            db.add(UserBlock(blocker_id=blocker_id, blocked_id=target_id))
    except IntegrityError:
        pass  # already blocked: idempotent
    db.commit()
    return touched | {blocker_id, target_id}


def unblock(db: Session, blocker_id: int, target_id: int) -> None:
    row = db.scalars(
        select(UserBlock).where(UserBlock.blocker_id == blocker_id, UserBlock.blocked_id == target_id)
    ).first()
    if row is not None:
        db.delete(row)
        db.commit()


def list_blocked(db: Session, blocker_id: int) -> PersonPage:
    ids = list(
        db.scalars(
            select(UserBlock.blocked_id).where(UserBlock.blocker_id == blocker_id).order_by(UserBlock.id.desc()).limit(200)
        )
    )
    profiles = (
        list(db.scalars(select(UserProfile).where(UserProfile.user_id.in_(ids)))) if ids else []
    )
    # Minimal cards: no avatar or details for people you blocked.
    cards = [
        c.model_copy(update={"avatar_url": None, "designation": None, "relationship": "blocked", "request_id": None})
        for c in people_service.cards(db, blocker_id, profiles, friends=set(), blocked_by_viewer=set(ids))
    ]
    return PersonPage(items=cards, has_more=False)
