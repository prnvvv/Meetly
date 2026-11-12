from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.schemas.participant import ParticipantCreate, ParticipantOut
from app.services import meeting_service, participant_service
from app.services.exceptions import InvalidRequestError, MeetingNotFoundError

router = APIRouter(prefix="/api", tags=["participants"])


def _http_error(exc: Exception) -> HTTPException:
    """Translate expected service failures into client-facing responses."""
    if isinstance(exc, MeetingNotFoundError):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc) or "Meeting not found")
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc) or "Invalid request")


def _forbidden() -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, "You are not part of this meeting")


@router.get(
    "/meetings/{meeting_id}/participants",
    response_model=list[ParticipantOut],
)
def list_meeting_participants(
    meeting_id: str,
    active_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ParticipantOut]:
    """Persisted participants; visible to the host and to people who joined."""
    try:
        meeting = meeting_service.require_meeting(db, meeting_id)
        participants = participant_service.get_meeting_participants(
            db,
            meeting_id,
            active_only=active_only,
        )
    except (MeetingNotFoundError, InvalidRequestError) as exc:
        raise _http_error(exc) from exc
    if meeting.host_id != user.id and not any(p.user_id == user.id for p in participants):
        raise _forbidden()
    return [ParticipantOut.model_validate(row) for row in participants]


@router.post(
    "/meetings/{meeting_id}/participants",
    response_model=ParticipantOut,
    status_code=status.HTTP_201_CREATED,
)
def add_meeting_participant(
    meeting_id: str,
    payload: ParticipantCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ParticipantOut:
    """Register the caller as a participant. Identity and host role come from the token."""
    try:
        meeting = meeting_service.require_meeting(db, meeting_id)
        # One participant row per person per meeting: a repeat call returns it.
        participant = participant_service.find_user_participant(db, meeting.id, user.id)
        if participant is None:
            participant = participant_service.create_participant(
                db,
                meeting_id=meeting_id,
                display_name=payload.display_name,
                is_host=meeting.host_id == user.id,
                user_id=user.id,
            )
    except (MeetingNotFoundError, InvalidRequestError) as exc:
        raise _http_error(exc) from exc
    return ParticipantOut.model_validate(participant)


@router.delete(
    "/participants/{participant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    # A 204 carries no body. Declaring that explicitly (instead of relying on
    # the `-> None` annotation) keeps the app importable on every FastAPI
    # version: older releases infer a response model from the annotation and
    # then assert "Status code 204 must not have a response body".
    response_model=None,
    response_class=Response,
)
def remove_participant(
    participant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Mark a participant as having left. Allowed for that participant and the meeting host."""
    participant = participant_service.get_participant(db, participant_id)
    if participant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant not found",
        )
    if participant.user_id != user.id and participant.meeting.host_id != user.id:
        raise _forbidden()
    participant_service.mark_participant_left(db, participant_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
