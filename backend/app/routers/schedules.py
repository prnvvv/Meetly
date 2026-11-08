from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Meeting
from app.models.user import DEMO_USER_ID
from app.schemas.schedule import (
    ScheduleMeetingCreate,
    ScheduleMeetingResponse,
    ScheduleMeetingUpdate,
)
from app.services import schedule_service
from app.services.exceptions import (
    InvalidRequestError,
    MeetingConflictError,
    MeetingNotFoundError,
)

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


@router.post(
    "", response_model=ScheduleMeetingResponse, status_code=status.HTTP_201_CREATED
)
def create_schedule(
    payload: ScheduleMeetingCreate, db: Session = Depends(get_db)
) -> Meeting:
    """Schedule a future meeting."""
    try:
        return schedule_service.create_scheduled_meeting(
            db, payload, host_id=DEMO_USER_ID
        )
    except MeetingConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc) or "Conflict") from exc
    except InvalidRequestError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, str(exc) or "Invalid request"
        ) from exc


@router.get("/upcoming", response_model=list[ScheduleMeetingResponse])
def list_upcoming(
    limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db)
) -> list[Meeting]:
    return schedule_service.get_upcoming_meetings(db, host_id=DEMO_USER_ID, limit=limit)


@router.get("/recent", response_model=list[ScheduleMeetingResponse])
def list_recent(
    limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db)
) -> list[Meeting]:
    return schedule_service.get_recent_meetings(db, host_id=DEMO_USER_ID, limit=limit)


@router.get("/range", response_model=list[ScheduleMeetingResponse])
def list_range(
    start: datetime,
    end: datetime,
    limit: int = Query(schedule_service.MAX_RANGE_LIMIT, ge=1, le=schedule_service.MAX_RANGE_LIMIT),
    db: Session = Depends(get_db),
) -> list[Meeting]:
    """Meetings starting in [start, end): the data behind the dashboard calendar."""
    try:
        return schedule_service.get_meetings_in_range(
            db, start=start, end=end, host_id=DEMO_USER_ID, limit=limit
        )
    except InvalidRequestError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.patch("/{meeting_id}", response_model=ScheduleMeetingResponse)
def update_schedule(
    payload: ScheduleMeetingUpdate,
    meeting_id: str = Path(min_length=1, max_length=32),
    db: Session = Depends(get_db),
) -> Meeting:
    """Edit a meeting that has not started yet."""
    try:
        return schedule_service.update_scheduled_meeting(
            db, meeting_id, payload, host_id=DEMO_USER_ID
        )
    except MeetingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc) or "Meeting not found") from exc
    except MeetingConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc) or "Conflict") from exc
    except InvalidRequestError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc) or "Invalid request") from exc
