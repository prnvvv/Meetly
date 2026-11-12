"""Persistent in-app notifications (retry-safe, minimal metadata)."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import utc_now
from app.models.profile import UserProfile
from app.models.social import Notification
from app.schemas.social import NotificationActor, NotificationOut, NotificationPage
from app.services import profile_service, relationships
from app.services.social_errors import SocialNotFound

DEFAULT_TTL = timedelta(days=60)
FRIEND_REQUEST = "friend_request"
FRIEND_REQUEST_ACCEPTED = "friend_request_accepted"


def create(
    db: Session,
    recipient_id: int,
    type_: str,
    *,
    entity_type: str | None = None,
    entity_id: int | None = None,
    payload: dict | None = None,
    dedupe_key: str | None = None,
    ttl: timedelta | None = DEFAULT_TTL,
) -> Notification | None:
    """Add a notification in the caller transaction. Returns None if it already exists."""
    note = Notification(
        recipient_id=recipient_id,
        type=type_,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
        dedupe_key=dedupe_key,
        expires_at=(utc_now() + ttl) if ttl else None,
    )
    try:
        with db.begin_nested():
            db.add(note)
        return note
    except IntegrityError:
        return None


def delete_by_dedupe_key(db: Session, dedupe_key: str) -> list[int]:
    """Remove a notification (for example a cancelled request); returns affected recipients."""
    rows = list(
        db.execute(
            select(Notification.recipient_id).where(Notification.dedupe_key == dedupe_key)
        ).scalars()
    )
    if rows:
        db.execute(delete(Notification).where(Notification.dedupe_key == dedupe_key))
    return rows


def _live(recipient_id: int):
    return (
        Notification.recipient_id == recipient_id,
        or_(Notification.expires_at.is_(None), Notification.expires_at > utc_now()),
    )


def unread_count(db: Session, recipient_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(*_live(recipient_id), Notification.read_at.is_(None))
        )
        or 0
    )


def list_for(
    db: Session,
    user_id: int,
    *,
    limit: int = 20,
    before_id: int | None = None,
    unread_only: bool = False,
) -> NotificationPage:
    stmt = select(Notification).where(*_live(user_id))
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    if before_id is not None:
        stmt = stmt.where(Notification.id < before_id)
    rows = list(db.scalars(stmt.order_by(Notification.id.desc()).limit(limit + 1)).all())
    has_more = len(rows) > limit
    rows = rows[:limit]

    actor_ids = {
        n.payload["actor_id"]
        for n in rows
        if n.payload and isinstance(n.payload.get("actor_id"), int)
    }
    profiles: dict[int, UserProfile] = {}
    friends: set[int] = set()
    hidden: set[int] = set()
    if actor_ids:
        profiles = {
            p.user_id: p
            for p in db.scalars(select(UserProfile).where(UserProfile.user_id.in_(actor_ids)))
        }
        friends = relationships.friend_ids(db, user_id)
        hidden = relationships.blocked_ids_either_way(db, user_id)
    urls = profile_service.sign_avatars(
        [
            p
            for p in profiles.values()
            if p.avatar_path
            and (p.visibility == "public" or (p.visibility == "friends" and p.user_id in friends))
        ]
    )

    items: list[NotificationOut] = []
    for n in rows:
        actor = None
        actor_id = (n.payload or {}).get("actor_id")
        if isinstance(actor_id, int):
            if actor_id in hidden:
                continue  # never surface content from someone blocked either way
            p = profiles.get(actor_id)
            if p:
                actor = NotificationActor(
                    user_id=p.user_id,
                    username=p.username,
                    display_name=p.display_name,
                    avatar_url=urls.get(p.avatar_path) if p.avatar_path else None,
                )
        items.append(
            NotificationOut(
                id=n.id,
                type=n.type,
                entity_type=n.entity_type,
                entity_id=n.entity_id,
                payload={k: v for k, v in (n.payload or {}).items() if k != "actor_id"} or None,
                actor=actor,
                read=n.read_at is not None,
                created_at=n.created_at,
            )
        )
    return NotificationPage(
        items=items,
        unread_count=unread_count(db, user_id),
        next_before_id=rows[-1].id if has_more and rows else None,
    )


def mark_read(db: Session, user_id: int, notification_id: int) -> None:
    """Idempotent. Another user notification looks exactly like a missing one."""
    note = db.get(Notification, notification_id)
    if note is None or note.recipient_id != user_id:
        raise SocialNotFound("Notification not found")
    if note.read_at is None:
        note.read_at = utc_now()
        db.commit()


def mark_all_read(db: Session, user_id: int) -> int:
    result = db.execute(
        update(Notification)
        .where(Notification.recipient_id == user_id, Notification.read_at.is_(None))
        .values(read_at=utc_now())
    )
    db.commit()
    return result.rowcount or 0


def purge_expired(db: Session, before: datetime | None = None) -> int:
    result = db.execute(delete(Notification).where(Notification.expires_at < (before or utc_now())))
    db.commit()
    return result.rowcount or 0
