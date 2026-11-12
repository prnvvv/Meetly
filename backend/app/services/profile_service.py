"""Profiles: creation, editing, privacy-filtered views, avatars and stats."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import distinct, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.meeting import Meeting, MeetingStatus
from app.models.participant import Participant
from app.models.profile import UserProfile
from app.models.user import User
from app.schemas.profile import (
    RESERVED_USERNAMES,
    USERNAME_RE,
    MeetingStats,
    ProfileOut,
    ProfileUpdate,
)
from app.services import relationships
from app.services.avatar_image import normalise_avatar
from app.services.exceptions import InvalidRequestError
from app.services.storage import StorageUnavailable, get_storage


class UsernameTakenError(Exception):
    pass


class ProfileNotFoundError(Exception):
    """Raised for missing AND hidden profiles, so existence is not revealed."""


def _slug(text_: str) -> str:
    slug = re.sub(r"[^a-z0-9_]+", "", re.sub(r"\s+", "_", text_.strip().lower()))
    slug = re.sub(r"^[^a-z]+", "", slug)[:24]
    return slug if len(slug) >= 3 and slug not in RESERVED_USERNAMES else ""


def _unique_username(db: Session, user: User) -> str:
    base = _slug(user.name) or f"user{user.id}"
    candidate = base
    n = 0
    while (
        db.scalar(select(UserProfile.user_id).where(UserProfile.username == candidate)) is not None
        or candidate in RESERVED_USERNAMES
    ):
        n += 1
        candidate = f"{base[:24]}{n}"
    return candidate


def ensure_profile(db: Session, user: User) -> UserProfile:
    """The user's profile, created on first use. Safe under concurrent calls."""
    profile = db.get(UserProfile, user.id)
    if profile is not None:
        return profile
    for _ in range(5):
        profile = UserProfile(
            user_id=user.id,
            username=_unique_username(db, user),
            display_name=(user.name or "Meetly User")[:100],
        )
        db.add(profile)
        try:
            db.commit()
            return profile
        except IntegrityError:
            db.rollback()
            existing = db.get(UserProfile, user.id)
            if existing is not None:
                return existing
    raise InvalidRequestError("Could not create a profile")


def username_status(
    db: Session, username: str, *, own_user_id: int | None = None
) -> tuple[bool, str | None]:
    name = username.strip().lower()
    if not USERNAME_RE.match(name):
        return False, "Use 3-30 letters, numbers or underscores, starting with a letter"
    if name in RESERVED_USERNAMES:
        return False, "That username is reserved"
    owner = db.scalar(select(UserProfile.user_id).where(UserProfile.username == name))
    if owner is not None and owner != own_user_id:
        return False, "That username is taken"
    return True, None


def update_profile(db: Session, user: User, patch: ProfileUpdate) -> UserProfile:
    profile = ensure_profile(db, user)
    data = patch.model_dump(exclude_unset=True)
    if "username" in data and data["username"] != profile.username:
        ok, reason = username_status(db, data["username"], own_user_id=user.id)
        if not ok:
            raise UsernameTakenError(reason or "That username is not available")
    for field, value in data.items():
        setattr(profile, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise UsernameTakenError("That username is taken") from None
    db.refresh(profile)
    return profile


def meeting_stats(db: Session, user_id: int) -> MeetingStats:
    hosted = (
        db.scalar(select(func.count()).select_from(Meeting).where(Meeting.host_id == user_id)) or 0
    )
    minutes = (
        db.scalar(
            select(func.coalesce(func.sum(Meeting.duration), 0)).where(
                Meeting.host_id == user_id, Meeting.status == MeetingStatus.ENDED
            )
        )
        or 0
    )
    attended = (
        db.scalar(
            select(func.count(distinct(Participant.meeting_id))).where(
                Participant.user_id == user_id
            )
        )
        or 0
    )
    return MeetingStats(
        meetings_hosted=hosted, meetings_attended=attended, minutes_hosted=int(minutes)
    )


def sign_avatars(profiles: list[UserProfile]) -> dict[str, str]:
    paths = [p.avatar_path for p in profiles if p.avatar_path]
    return get_storage().sign_many(paths) if paths else {}


def build_view(
    db: Session,
    viewer_id: int,
    profile: UserProfile,
    *,
    avatar_urls: dict[str, str] | None = None,
) -> ProfileOut:
    """Apply privacy rules. Raises ProfileNotFoundError when the viewer may not see it."""
    is_self = viewer_id == profile.user_id
    full = is_self
    if not is_self:
        rel = relationships.relation(db, viewer_id, profile.user_id)
        if rel.blocked or profile.visibility == "private":
            raise ProfileNotFoundError("Profile not found")
        full = profile.visibility == "public" or (
            profile.visibility == "friends" and rel.is_friend
        )

    urls = avatar_urls if avatar_urls is not None else sign_avatars([profile])
    out = ProfileOut(
        user_id=profile.user_id,
        username=profile.username,
        display_name=profile.display_name,
        avatar_url=urls.get(profile.avatar_path) if (full and profile.avatar_path) else None,
        limited=not full,
        is_self=is_self,
    )
    if full:
        out.bio = profile.bio
        out.location = profile.location
        out.designation = profile.designation
        out.organization = profile.organization
        out.website = profile.website
        out.social_links = profile.social_links or {}
        out.created_at = profile.created_at
        if is_self or profile.show_meeting_stats:
            out.stats = meeting_stats(db, profile.user_id)
    if is_self:
        out.visibility = profile.visibility  # type: ignore[assignment]
        out.show_meeting_stats = profile.show_meeting_stats
        out.updated_at = profile.updated_at
    return out


def get_view(db: Session, viewer_id: int, target_user_id: int) -> ProfileOut:
    profile = db.get(UserProfile, target_user_id)
    if profile is None:
        user = db.get(User, target_user_id)
        if user is None or target_user_id != viewer_id:
            raise ProfileNotFoundError("Profile not found")
        profile = ensure_profile(db, user)
    return build_view(db, viewer_id, profile)


def set_avatar(db: Session, user: User, raw: bytes) -> UserProfile:
    """Validate, re-encode, store, then swap the profile pointer; clean up the old object."""
    processed = normalise_avatar(raw)
    profile = ensure_profile(db, user)
    storage = get_storage()
    new_path = f"{user.id}/{uuid.uuid4().hex}.webp"
    storage.upload(new_path, processed, "image/webp")  # raises StorageUnavailable
    old = profile.avatar_path
    profile.avatar_path = new_path
    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete([new_path])
        raise
    if old:
        storage.delete([old])
    db.refresh(profile)
    return profile


def remove_avatar(db: Session, user: User) -> UserProfile:
    profile = ensure_profile(db, user)
    old = profile.avatar_path
    if old:
        profile.avatar_path = None
        db.commit()
        get_storage().delete([old])
    return profile


__all__ = [
    "StorageUnavailable",
    "UsernameTakenError",
    "ProfileNotFoundError",
    "ensure_profile",
    "update_profile",
    "get_view",
    "build_view",
    "set_avatar",
    "remove_avatar",
    "username_status",
]
