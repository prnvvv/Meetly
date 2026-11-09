from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserPreferences(BaseModel):
    """Device ids can disappear between sessions, so clients must tolerate unknown ones."""

    model_config = ConfigDict(extra="forbid")

    camera_id: str | None = Field(default=None, max_length=255)
    microphone_id: str | None = Field(default=None, max_length=255)
    speaker_id: str | None = Field(default=None, max_length=255)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    created_at: datetime
    preferences: UserPreferences = Field(default_factory=UserPreferences)


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=100)
    preferences: UserPreferences | None = None
