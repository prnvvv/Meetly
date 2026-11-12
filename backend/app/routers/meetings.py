from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Meeting
from app.auth import get_current_user
from app.models.user import User
from app.schemas.meeting import MeetingCreate, MeetingJoinRequest, MeetingResponse
from app.security.ratelimit import limiter, rate_limit
from app.services import meeting_service, participant_service
from app.services.exceptions import (
    InvalidPasswordError,
    InvalidRequestError,
    MeetingConflictError,
    MeetingNotFoundError,
    PermissionDeniedError,
)

router = APIRouter(prefix="/api/meetings", tags=["meetings"])

PublicMeetingId = Path(min_length=1, max_length=32, description="Public meeting ID")


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, MeetingNotFoundError):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc) or "Meeting not found")
    if isinstance(exc, MeetingConflictError):
        return HTTPException(status.HTTP_409_CONFLICT, str(exc) or "Meeting conflict")
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(exc) or "Not allowed")
    if isinstance(exc, InvalidPasswordError):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(exc) or "Incorrect meeting password")
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc) or "Invalid request")


@router.post("", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
def create_meeting(
    payload: MeetingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Meeting:
    """Create an instant meeting."""
    try:
        return meeting_service.create_meeting(db, payload, host_id=user.id)
    except InvalidRequestError as exc:
        raise _http_error(exc) from exc


@router.get(
    "/{meeting_id}",
    response_model=MeetingResponse,
    dependencies=[Depends(rate_limit("meeting-get", 120, 60))],
)
def get_meeting(
    meeting_id: str = PublicMeetingId,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MeetingResponse:
    meeting = meeting_service.get_meeting(db, meeting_id)
    if meeting is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    response = MeetingResponse.model_validate(meeting)
    if meeting.host_id != user.id and not participant_service.find_user_participant(
        db, meeting.id, user.id
    ):
        # Anyone with a meeting id may look it up to join, but the host private
        # notes and settings are only for people who are part of the meeting.
        response = response.model_copy(update={"description": None, "settings": {}})
    return response


@router.post(
    "/{meeting_id}/join",
    response_model=MeetingResponse,
    dependencies=[Depends(rate_limit("meeting-join", 30, 60))],
)
def join_meeting(
    payload: MeetingJoinRequest,
    meeting_id: str = PublicMeetingId,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Meeting:
    """Validate that the meeting is joinable.

    Participant records and realtime state are created over WebSocket.
    """
    attempt_key = f"{user.id}:{meeting_id}"
    if limiter.peek("meeting-password", attempt_key, 10, 600):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many wrong passwords. Try again later.",
            headers={"Retry-After": "600"},
        )
    try:
        return meeting_service.validate_meeting(
            db, meeting_id, password=payload.password
        )
    except InvalidPasswordError as exc:
        limiter.check("meeting-password", attempt_key, 10, 600)  # count the failure
        raise _http_error(exc) from exc
    except (
        MeetingNotFoundError,
        MeetingConflictError,
        InvalidRequestError,
        InvalidPasswordError,
    ) as exc:
        raise _http_error(exc) from exc


@router.delete("/{meeting_id}", response_model=MeetingResponse)
def end_meeting(
    meeting_id: str = PublicMeetingId,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Meeting:
    """End (or cancel) a meeting. History is preserved."""
    try:
        return meeting_service.end_meeting(db, meeting_id, host_id=user.id)
    except (MeetingNotFoundError, MeetingConflictError, InvalidRequestError) as exc:
        raise _http_error(exc) from exc
