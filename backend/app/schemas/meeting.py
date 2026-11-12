from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.models.meeting import MeetingStatus

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]


# Settings the host can save with a meeting. Only `lockMeeting` is enforced by the
# server today (new joiners are refused); the rest are stored and returned so the
# room can honour them later. Unknown keys are rejected so typos never pass silently.
ALLOWED_SETTINGS = frozenset(
    {
        "waitingRoom",
        "lockMeeting",
        "muteOnEntry",
        "allowUnmute",
        "allowScreenShare",
        "allowChat",
        "hostControls",
        "record",
    }
)
ENFORCED_SETTINGS = frozenset({"lockMeeting"})


def validate_settings(value: dict[str, bool] | None) -> dict[str, bool] | None:
    if value is None:
        return None
    unknown = set(value) - ALLOWED_SETTINGS
    if unknown:
        raise ValueError(f"Unknown meeting settings: {', '.join(sorted(unknown))}")
    return {k: bool(v) for k, v in value.items()}


class MeetingCreate(BaseModel):
    title: Title
    description: str | None = Field(default=None, max_length=5000)
    password: str | None = Field(default=None, max_length=128)
    settings: dict[str, bool] | None = None

    _check_settings = field_validator("settings")(validate_settings)


class MeetingJoinRequest(BaseModel):
    display_name: DisplayName
    password: str | None = Field(default=None, max_length=128)


class MeetingResponse(BaseModel):
    """Mirrors the Meeting model exactly."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    meeting_id: str
    host_id: int
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime | None
    duration: int | None
    status: MeetingStatus
    meeting_link: str
    created_at: datetime
    settings: dict[str, bool] = Field(default_factory=dict)
    # Server-enforced waiting room. Existing meetings are false.
    waiting_room_enabled: bool = False
    admission_mode: str = "host_approval"

    @model_validator(mode="after")
    def _settings_reflect_waiting_room(self) -> "MeetingResponse":
        """The legacy ``settings.waitingRoom`` key was never enforced; report the truth."""
        if self.waiting_room_enabled or "waitingRoom" in self.settings:
            self.settings = {**self.settings, "waitingRoom": self.waiting_room_enabled}
        return self

    @field_validator("settings", mode="before")
    @classmethod
    def _decode_settings(cls, value: object) -> object:
        """The column stores JSON text; the API returns an object."""
        if value is None or value == "":
            return {}
        if isinstance(value, str):
            import json

            try:
                decoded = json.loads(value)
            except ValueError:
                return {}
            return decoded if isinstance(decoded, dict) else {}
        return value
