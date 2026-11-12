from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RelationshipState = Literal["none", "friend", "request_sent", "request_received", "blocked"]


class PersonOut(BaseModel):
    """A minimal, privacy-filtered card for lists and search results (never email)."""

    user_id: int
    username: str
    display_name: str
    avatar_url: str | None = None
    designation: str | None = None
    relationship: RelationshipState = "none"
    request_id: int | None = None


class PersonPage(BaseModel):
    items: list[PersonOut]
    has_more: bool


class FriendRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: int = Field(gt=0)


class FriendRequestOut(BaseModel):
    id: int
    status: str
    created_at: datetime
    responded_at: datetime | None = None
    person: PersonOut  # the other party (sender when incoming, receiver when outgoing)


class FriendRequestResult(BaseModel):
    """Outcome of sending a request: accepted when it matched a reciprocal one."""

    request_id: int
    status: str
    friendship_created: bool


class NotificationActor(BaseModel):
    user_id: int
    username: str
    display_name: str
    avatar_url: str | None = None


class NotificationOut(BaseModel):
    id: int
    type: str
    entity_type: str | None = None
    entity_id: int | None = None
    payload: dict | None = None
    actor: NotificationActor | None = None
    read: bool
    created_at: datetime


class NotificationPage(BaseModel):
    items: list[NotificationOut]
    unread_count: int
    next_before_id: int | None = None
