from __future__ import annotations

from typing import Any, Literal, Union, get_args

from pydantic import BaseModel, ConfigDict, Field


class ErrorCode:
    MEETING_NOT_FOUND = "MEETING_NOT_FOUND"
    MEETING_ENDED = "MEETING_ENDED"
    NOT_A_PARTICIPANT = "NOT_A_PARTICIPANT"
    NOT_HOST = "NOT_HOST"
    TARGET_NOT_FOUND = "TARGET_NOT_FOUND"
    INVALID_MESSAGE = "INVALID_MESSAGE"
    UNAUTHORIZED_ACTION = "UNAUTHORIZED_ACTION"
    NOT_ADMITTED = "NOT_ADMITTED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ClientEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str


class JoinMessage(ClientEvent):
    type: Literal["join"]
    meeting_id: str = Field(min_length=1, max_length=64)
    participant_id: int | None = Field(default=None, ge=1)
    display_name: str = Field(min_length=1, max_length=120)
    password: str | None = Field(default=None, max_length=128)
    # Clerk session token. Required unless the server runs in demo auth mode.
    token: str | None = Field(default=None, max_length=8192)


class LeaveMessage(ClientEvent):
    type: Literal["leave"]
    participant_id: int = Field(ge=1)


class OfferMessage(ClientEvent):
    type: Literal["offer"]
    sender_id: int = Field(ge=1)
    target_id: int = Field(ge=1)
    payload: dict[str, Any]


class AnswerMessage(ClientEvent):
    type: Literal["answer"]
    sender_id: int = Field(ge=1)
    target_id: int = Field(ge=1)
    payload: dict[str, Any]


class IceCandidateMessage(ClientEvent):
    type: Literal["ice_candidate"]
    sender_id: int = Field(ge=1)
    target_id: int = Field(ge=1)
    payload: dict[str, Any]


class MeetingStateMessage(ClientEvent):
    """Client requests an authoritative snapshot of current meeting state."""

    type: Literal["meeting_state"]
    participant_id: int = Field(ge=1)


class MediaStateMessage(ClientEvent):
    type: Literal["media_state"]
    participant_id: int = Field(ge=1)
    is_muted: bool
    is_video_on: bool


class ScreenShareMessage(ClientEvent):
    type: Literal["screen_share"]
    participant_id: int = Field(ge=1)
    active: bool


class MuteParticipantMessage(ClientEvent):
    type: Literal["mute_participant"]
    participant_id: int = Field(ge=1)
    target_id: int = Field(ge=1)
    # Optional so existing clients keep muting; False unmutes the target.
    is_muted: bool = True


class RemoveParticipantMessage(ClientEvent):
    type: Literal["remove_participant"]
    participant_id: int = Field(ge=1)
    target_id: int = Field(ge=1)


class EndMeetingMessage(ClientEvent):
    type: Literal["end_meeting"]
    participant_id: int = Field(ge=1)


class ReactionMessage(ClientEvent):
    """Transient emoji reaction; never persisted to participant state."""

    type: Literal["reaction"]
    participant_id: int = Field(ge=1)
    emoji: str = Field(min_length=1, max_length=16)


class PingMessage(ClientEvent):
    type: Literal["ping"]


AnyClientMessage = Union[
    JoinMessage,
    LeaveMessage,
    OfferMessage,
    AnswerMessage,
    IceCandidateMessage,
    MeetingStateMessage,
    MediaStateMessage,
    ScreenShareMessage,
    MuteParticipantMessage,
    RemoveParticipantMessage,
    EndMeetingMessage,
    ReactionMessage,
    PingMessage,
]

CLIENT_MESSAGE_TYPES = (
    JoinMessage,
    LeaveMessage,
    OfferMessage,
    AnswerMessage,
    IceCandidateMessage,
    MeetingStateMessage,
    MediaStateMessage,
    ScreenShareMessage,
    MuteParticipantMessage,
    RemoveParticipantMessage,
    EndMeetingMessage,
    ReactionMessage,
    PingMessage,
)


def _literal_of(model: type[ClientEvent]) -> str:
    """Extract the single ``Literal`` value from a message model's ``type`` field.

    ``type`` is annotated as ``Literal["join"]`` and so carries no field
    default; the literal lives on the annotation.
    """
    annotation = model.model_fields["type"].annotation
    values = get_args(annotation)
    if len(values) != 1 or not isinstance(values[0], str):
        raise TypeError(f"{model.__name__}.type must be a single string Literal")
    return values[0]


_MESSAGE_TYPE_MAP: dict[str, type[ClientEvent]] = {
    _literal_of(model): model for model in CLIENT_MESSAGE_TYPES
}


def parse_client_message(raw: Any) -> AnyClientMessage:
    """Validate an inbound realtime payload into a typed message.

    Raises ``ValueError`` when the payload is not a known, well-formed event.
    """
    if not isinstance(raw, dict):
        raise ValueError("Message must be a JSON object")

    event_type = raw.get("type")
    if not isinstance(event_type, str):
        raise ValueError("Message is missing a string 'type' field")

    model = _MESSAGE_TYPE_MAP.get(event_type)
    if model is None:
        raise ValueError(f"Unsupported message type: {event_type}")

    return model.model_validate(raw)