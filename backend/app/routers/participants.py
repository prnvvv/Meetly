from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.participant import ParticipantCreate, ParticipantOut
from app.services import participant_service
from app.services.exceptions import InvalidRequestError, MeetingNotFoundError

router = APIRouter(prefix="/api", tags=["participants"])


def _http_error(exc: Exception) -> HTTPException:
    """Translate expected service failures into client-facing responses."""
    if isinstance(exc, MeetingNotFoundError):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc) or "Meeting not found")
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc) or "Invalid request")


@router.get(
    "/meetings/{meeting_id}/participants",
    response_model=list[ParticipantOut],
)
def list_meeting_participants(
    meeting_id: str,
    active_only: bool = False,
    db: Session = Depends(get_db),
) -> list[ParticipantOut]:
    """Return persisted participants for a meeting."""
    try:
        participants = participant_service.get_meeting_participants(
            db,
            meeting_id,
            active_only=active_only,
        )
    except (MeetingNotFoundError, InvalidRequestError) as exc:
        raise _http_error(exc) from exc
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
) -> ParticipantOut:
    """Create a participant record for a meeting."""
    try:
        participant = participant_service.create_participant(
            db,
            meeting_id=meeting_id,
            display_name=payload.display_name,
            is_host=False,
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
) -> Response:
    """Mark a participant as having left the meeting."""
    participant = participant_service.get_participant(db, participant_id)
    if participant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant not found",
        )
    participant_service.mark_participant_left(db, participant_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
