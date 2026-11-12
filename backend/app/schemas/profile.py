from __future__ import annotations

import re
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

Visibility = Literal["public", "friends", "private"]

USERNAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,29}$")
RESERVED_USERNAMES = frozenset(
    {"admin", "administrator", "meetly", "support", "help", "system", "root", "me",
     "null", "undefined", "api", "moderator", "staff", "security", "official"}
)
SOCIAL_KEYS = ("twitter", "linkedin", "github", "instagram", "facebook", "youtube")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(value: str | None) -> str | None:
    """Strip, drop control characters, and map empty strings to None."""
    if value is None:
        return None
    cleaned = _CONTROL.sub("", value).strip()
    return cleaned or None


def validate_http_url(value: str | None, *, https_only: bool = False) -> str | None:
    value = clean_text(value)
    if value is None:
        return None
    parts = urlsplit(value)
    allowed = ("https",) if https_only else ("http", "https")
    if parts.scheme not in allowed or not parts.netloc or " " in value:
        raise ValueError("Enter a valid link starting with https://")
    return value


def validate_username(value: str) -> str:
    username = value.strip().lower()
    if not USERNAME_RE.match(username):
        raise ValueError(
            "Username must be 3-30 characters: letters, numbers or underscores, starting with a letter"
        )
    if username in RESERVED_USERNAMES:
        raise ValueError("That username is reserved")
    return username


class ProfileUpdate(BaseModel):
    """Only the fields listed here can ever be changed by a client (no mass assignment)."""

    model_config = ConfigDict(extra="forbid")

    username: str | None = None
    display_name: str | None = Field(default=None, max_length=100)
    bio: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=100)
    designation: str | None = Field(default=None, max_length=100)
    organization: str | None = Field(default=None, max_length=100)
    website: str | None = Field(default=None, max_length=255)
    social_links: dict[str, str | None] | None = None
    visibility: Visibility | None = None
    show_meeting_stats: bool | None = None

    @field_validator("username")
    @classmethod
    def _username(cls, v: str | None) -> str | None:
        if v is None:
            raise ValueError("Username cannot be empty")
        return validate_username(v)

    @field_validator("display_name")
    @classmethod
    def _display_name(cls, v: str | None) -> str | None:
        cleaned = clean_text(v)
        if cleaned is None:
            raise ValueError("Display name cannot be empty")
        return cleaned

    @field_validator("bio", "location", "designation", "organization")
    @classmethod
    def _text(cls, v: str | None) -> str | None:
        return clean_text(v)

    @field_validator("website")
    @classmethod
    def _website(cls, v: str | None) -> str | None:
        return validate_http_url(v)

    @field_validator("social_links")
    @classmethod
    def _links(cls, v: dict[str, str | None] | None) -> dict[str, str] | None:
        if v is None:
            return None
        unknown = set(v) - set(SOCIAL_KEYS)
        if unknown:
            raise ValueError(f"Unsupported social links: {', '.join(sorted(unknown))}")
        out: dict[str, str] = {}
        for key, link in v.items():
            checked = validate_http_url(link, https_only=True)
            if checked:
                if len(checked) > 255:
                    raise ValueError("Link is too long")
                out[key] = checked
        return out


class MeetingStats(BaseModel):
    meetings_hosted: int
    meetings_attended: int
    minutes_hosted: int


class ProfileOut(BaseModel):
    """What a viewer is allowed to see. Fields hidden from the viewer are null."""

    user_id: int
    username: str
    display_name: str
    avatar_url: str | None = None
    # True when the viewer only gets the minimal card (friends-only profile, not a friend).
    limited: bool = False
    is_self: bool = False
    bio: str | None = None
    location: str | None = None
    designation: str | None = None
    organization: str | None = None
    website: str | None = None
    social_links: dict[str, str] | None = None
    created_at: datetime | None = None
    stats: MeetingStats | None = None
    # Owner-only settings.
    visibility: Visibility | None = None
    show_meeting_stats: bool | None = None
    updated_at: datetime | None = None


class UsernameAvailability(BaseModel):
    username: str
    available: bool
    reason: str | None = None
