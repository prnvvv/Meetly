"""Relationship lookups between users, used for privacy and permission decisions."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models.social import Friendship, UserBlock


@dataclass(frozen=True)
class Relation:
    is_friend: bool = False
    # Either side has blocked the other.
    blocked: bool = False
    # The viewer is the one who blocked (vs. being blocked by the target).
    blocked_by_viewer: bool = False


def canonical_pair(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def are_friends(db: Session, a: int, b: int) -> bool:
    low, high = canonical_pair(a, b)
    return (
        db.scalar(
            select(Friendship.id).where(
                Friendship.user_low_id == low, Friendship.user_high_id == high
            )
        )
        is not None
    )


def is_blocked_either_way(db: Session, a: int, b: int) -> bool:
    return (
        db.scalar(
            select(UserBlock.id).where(
                or_(
                    and_(UserBlock.blocker_id == a, UserBlock.blocked_id == b),
                    and_(UserBlock.blocker_id == b, UserBlock.blocked_id == a),
                )
            )
        )
        is not None
    )


def relation(db: Session, viewer_id: int, target_id: int) -> Relation:
    if viewer_id == target_id:
        return Relation()
    blocks = db.execute(
        select(UserBlock.blocker_id).where(
            or_(
                and_(UserBlock.blocker_id == viewer_id, UserBlock.blocked_id == target_id),
                and_(UserBlock.blocker_id == target_id, UserBlock.blocked_id == viewer_id),
            )
        )
    ).scalars().all()
    return Relation(
        is_friend=are_friends(db, viewer_id, target_id),
        blocked=bool(blocks),
        blocked_by_viewer=viewer_id in blocks,
    )


def friend_ids(db: Session, user_id: int) -> set[int]:
    rows = db.execute(
        select(Friendship.user_low_id, Friendship.user_high_id).where(
            or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id)
        )
    ).all()
    return {high if low == user_id else low for low, high in rows}


def blocked_ids_either_way(db: Session, user_id: int) -> set[int]:
    rows = db.execute(
        select(UserBlock.blocker_id, UserBlock.blocked_id).where(
            or_(UserBlock.blocker_id == user_id, UserBlock.blocked_id == user_id)
        )
    ).all()
    return {blocked if blocker == user_id else blocker for blocker, blocked in rows}
