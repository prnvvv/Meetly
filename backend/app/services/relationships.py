"""Relationship lookup between two users, used for privacy decisions.

The friendships and blocks tables arrive with the friends system (Stage 4);
until then nobody is a friend and nobody is blocked, so ``friends``-only
profiles are limited for everyone but their owner. The function signature is the
stable seam the profile privacy code already depends on.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session


@dataclass(frozen=True)
class Relation:
    is_friend: bool = False
    # Either side has blocked the other.
    blocked: bool = False


def relation(db: Session, viewer_id: int, target_id: int) -> Relation:
    return Relation()
