from typing import Any

from pydantic import AwareDatetime, BaseModel, Field, field_validator

from app.schemas.meeting import MeetingResponse, Title, validate_settings


class ScheduleMeetingCreate(BaseModel):
    title: Title
    description: str | None = Field(default=None, max_length=5000)
    # Timezone-aware ISO 8601 only: naive values are rejected by the DB layer.
    start_time: AwareDatetime
    duration: int = Field(gt=0, le=1440, description="Minutes")
    # Optional join password; stored hashed, same rules as instant meetings.
    password: str | None = Field(default=None, max_length=128)
    settings: dict[str, bool] | None = None

    _check_settings = field_validator("settings")(validate_settings)

    @field_validator("duration", mode="before")
    @classmethod
    def _reject_bool(cls, value: Any) -> Any:
        """JSON true/false must not be coerced into 1/0 minutes."""
        if isinstance(value, bool):
            raise ValueError("Duration must be a number of minutes, not a boolean")
        return value


class ScheduleMeetingUpdate(BaseModel):
    """Partial edit of a meeting that has not started yet."""

    title: Title | None = None
    description: str | None = Field(default=None, max_length=5000)
    start_time: AwareDatetime | None = None
    duration: int | None = Field(default=None, gt=0, le=1440, description="Minutes")

    @field_validator("duration", mode="before")
    @classmethod
    def _reject_bool(cls, value: Any) -> Any:
        if isinstance(value, bool):
            raise ValueError("Duration must be a number of minutes, not a boolean")
        return value


class ScheduleMeetingResponse(MeetingResponse):
    """Same shape as MeetingResponse so the frontend has one meeting type."""
