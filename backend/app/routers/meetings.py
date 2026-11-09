from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Meeting
from app.auth import get_current_user
from app.models.user import User
from app.schemas.meeting import MeetingCreate, MeetingJoinRequest, MeetingResponse
from app.services import meeting_service
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


@router.get("/{meeting_id}", response_model=MeetingResponse)
def get_meeting(
    meeting_id: str = PublicMeetingId,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Meeting:
    meeting = meeting_service.get_meeting(db, meeting_id)
    if meeting is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return meeting


@router.post("/{meeting_id}/join", response_model=MeetingResponse)
def join_meeting(
    payload: MeetingJoinRequest,
    meeting_id: str = PublicMeetingId,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Meeting:
    """Validate that the meeting is joinable.

    Participant records and realtime state are created over WebSocket.
    """
    try:
        return meeting_service.validate_meeting(
            db, meeting_id, password=payload.password
        )
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
