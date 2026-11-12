"""People cards, search and discovery. Always privacy-filtered; never returns email."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.models.meeting import Meeting
from app.models.participant import Participant
from app.models.profile import UserProfile
from app.models.social import FriendRequest, FriendRequestStatus
from app.schemas.social import PersonOut, PersonPage
from app.services import profile_service, relationships

MAX_LIMIT = 20


def _escape_like(text_: str) -> str:
    return text_.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def pending_between(db: Session, viewer_id: int, other_ids: Iterable[int]) -> dict[int, tuple[str, int]]:
    """{other_user_id: ("request_sent" | "request_received", request_id)} for pending requests."""
    ids = set(other_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(FriendRequest.id, FriendRequest.sender_id, FriendRequest.receiver_id).where(
            FriendRequest.status == FriendRequestStatus.PENDING.value,
            or_(
                (FriendRequest.sender_id == viewer_id) & FriendRequest.receiver_id.in_(ids),
                (FriendRequest.receiver_id == viewer_id) & FriendRequest.sender_id.in_(ids),
            ),
        )
    ).all()
    out: dict[int, tuple[str, int]] = {}
    for rid, sender, receiver in rows:
        if sender == viewer_id:
            out[receiver] = ("request_sent", rid)
        else:
            out[sender] = ("request_received", rid)
    return out


def cards(
    db: Session,
    viewer_id: int,
    profiles: list[UserProfile],
    *,
    friends: set[int] | None = None,
    blocked_by_viewer: set[int] | None = None,
) -> list[PersonOut]:
    """Build cards for the viewer. Avatar and designation only when the viewer may see them."""
    friends = relationships.friend_ids(db, viewer_id) if friends is None else friends
    pending = pending_between(db, viewer_id, (p.user_id for p in profiles))

    def full_access(p: UserProfile) -> bool:
        return p.visibility == "public" or (p.visibility == "friends" and p.user_id in friends)

    urls = profile_service.sign_avatars([p for p in profiles if p.avatar_path and full_access(p)])
    result: list[PersonOut] = []
    for p in profiles:
        if blocked_by_viewer and p.user_id in blocked_by_viewer:
            state, request_id = "blocked", None
        elif p.user_id in friends:
            state, request_id = "friend", None
        elif p.user_id in pending:
            state, request_id = pending[p.user_id]
        else:
            state, request_id = "none", None
        full = full_access(p)
        result.append(
            PersonOut(
                user_id=p.user_id,
                username=p.username,
                display_name=p.display_name,
                avatar_url=urls.get(p.avatar_path) if (full and p.avatar_path) else None,
                designation=p.designation if full else None,
                relationship=state,  # type: ignore[arg-type]
                request_id=request_id,
            )
        )
    return result


def search(db: Session, viewer_id: int, query: str, *, limit: int = MAX_LIMIT, offset: int = 0) -> PersonPage:
    q = query.strip().lower()
    limit = max(1, min(limit, MAX_LIMIT))
    if len(q) < 2:
        return PersonPage(items=[], has_more=False)
    friends = relationships.friend_ids(db, viewer_id)
    excluded = relationships.blocked_ids_either_way(db, viewer_id) | {viewer_id}
    like = _escape_like(q)
    visible = UserProfile.visibility != "private"
    if friends:
        visible = visible | UserProfile.user_id.in_(friends)
    rank = case(
        (func.lower(UserProfile.username) == q, 0),
        (UserProfile.username.like(f"{like}%", escape="\\"), 1),
        else_=2,
    )
    stmt = (
        select(UserProfile)
        .where(
            visible,
            UserProfile.user_id.not_in(excluded),
            or_(
                UserProfile.username.like(f"{like}%", escape="\\"),
                func.lower(UserProfile.display_name).like(f"%{like}%", escape="\\"),
            ),
        )
        .order_by(rank, UserProfile.username)
        .limit(limit + 1)
        .offset(max(0, offset))
    )
    rows = list(db.scalars(stmt))
    return PersonPage(
        items=cards(db, viewer_id, rows[:limit], friends=friends), has_more=len(rows) > limit
    )


def discover(db: Session, viewer_id: int, *, limit: int = MAX_LIMIT) -> PersonPage:
    """People you have shared a meeting with, who are not yet friends."""
    limit = max(1, min(limit, MAX_LIMIT))
    mine = select(Participant.meeting_id).where(Participant.user_id == viewer_id)
    hosted = select(Meeting.id).where(Meeting.host_id == viewer_id)
    meeting_ids = mine.union(hosted).subquery()
    co_participants = select(Participant.user_id).where(
        Participant.meeting_id.in_(select(meeting_ids)), Participant.user_id.is_not(None)
    )
    co_hosts = select(Meeting.host_id).where(Meeting.id.in_(select(meeting_ids)))
    candidates = co_participants.union(co_hosts).subquery()

    friends = relationships.friend_ids(db, viewer_id)
    excluded = relationships.blocked_ids_either_way(db, viewer_id) | friends | {viewer_id}
    rows = list(
        db.scalars(
            select(UserProfile)
            .where(
                UserProfile.user_id.in_(select(candidates)),
                UserProfile.user_id.not_in(excluded),
                UserProfile.visibility != "private",
            )
            .order_by(UserProfile.username)
            .limit(limit + 1)
        )
    )
    return PersonPage(
        items=cards(db, viewer_id, rows[:limit], friends=friends), has_more=len(rows) > limit
    )
