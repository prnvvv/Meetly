"""Host controls for the waiting room. Every route is host-only and enforced here,
not by hiding buttons in the UI. Live updates go out over the existing meeting socket."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth import get_current_user
from app.database.session import get_db
from app.models.meeting import Meeting, MeetingStatus
from app.models.user import User
from app.security.ratelimit import rate_limit
from app.services import meeting_service, waiting_room_service as wr
from app.services.exceptions import MeetingNotFoundError
from app.websocket import waiting_room_events as events
from app.websocket.manager import get_manager

router = APIRouter(prefix="/api/meetings/{meeting_id}/waiting-room", tags=["waiting-room"])

PublicMeetingId = Path(min_length=1, max_length=32, description="Public meeting ID")


class WaitingEntryOut(BaseModel):
    id: int
    display_name: str
    username: str | None = None
    requested_at: str


class WaitingRoomOut(BaseModel):
    enabled: bool
    admission_mode: str
    entries: list[WaitingEntryOut]


class WaitingRoomUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class DecisionOut(BaseModel):
    id: int
    state: str
    changed: bool


class AdmitAllOut(BaseModel):
    admitted: int


def _host_meeting(db: Session, meeting_id: str, user: User) -> Meeting:
    try:
        meeting = meeting_service.require_meeting(db, meeting_id)
    except MeetingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found") from exc
    if meeting.host_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the host can manage the waiting room")
    if meeting.status in (MeetingStatus.ENDED, MeetingStatus.CANCELLED):
        raise HTTPException(status.HTTP_409_CONFLICT, "This meeting has ended")
    return meeting


async def _snapshot(db: Session, meeting: Meeting) -> WaitingRoomOut:
    connected = await get_manager().lobby_user_ids(meeting.meeting_id)
    rows = await run_in_threadpool(wr.list_waiting, db, meeting, connected)
    return WaitingRoomOut(
        enabled=meeting.waiting_room_enabled,
        admission_mode=meeting.admission_mode,
        entries=[WaitingEntryOut(**events.entry_payload(e, name)) for e, name in rows],
    )


@router.get("", response_model=WaitingRoomOut)
async def get_waiting_room(
    meeting_id: str = PublicMeetingId,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WaitingRoomOut:
    meeting = await run_in_threadpool(_host_meeting, db, meeting_id, user)
    return await _snapshot(db, meeting)


@router.patch(
    "",
    response_model=WaitingRoomOut,
    dependencies=[Depends(rate_limit("waiting-room-toggle", 30, 60))],
)
async def set_waiting_room(
    payload: WaitingRoomUpdate,
    meeting_id: str = PublicMeetingId,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WaitingRoomOut:
    """Turn the waiting room on or off. Turning it off admits everyone still waiting."""
    meeting = await run_in_threadpool(_host_meeting, db, meeting_id, user)
    manager = get_manager()
    admitted = await run_in_threadpool(wr.set_enabled, db, meeting, payload.enabled, user.id)
    await events.notify_admitted(manager, meeting.meeting_id, admitted)
    await events.push_host_update(manager, db, meeting)
    return await _snapshot(db, meeting)


def _decision(action, db: Session, meeting: Meeting, entry_id: int, host_id: int):
    try:
        return action(db, meeting, entry_id, host_id)
    except wr.EntryNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Waiting-room entry not found") from exc
    except wr.InvalidTransition as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"This person is already {exc.current.lower()}"
        ) from exc


@router.post("/admit-all", response_model=AdmitAllOut)
async def admit_all(
    meeting_id: str = PublicMeetingId,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdmitAllOut:
    meeting = await run_in_threadpool(_host_meeting, db, meeting_id, user)
    changed = await run_in_threadpool(wr.admit_all, db, meeting, user.id)
    manager = get_manager()
    await events.notify_admitted(manager, meeting.meeting_id, changed)
    await events.push_host_update(manager, db, meeting)
    return AdmitAllOut(admitted=len(changed))


@router.post("/{entry_id}/admit", response_model=DecisionOut)
async def admit(
    entry_id: int,
    meeting_id: str = PublicMeetingId,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DecisionOut:
    meeting = await run_in_threadpool(_host_meeting, db, meeting_id, user)
    entry, changed = await run_in_threadpool(_decision, wr.admit, db, meeting, entry_id, user.id)
    manager = get_manager()
    if changed:
        await events.notify_admitted(manager, meeting.meeting_id, [entry])
        await events.push_host_update(manager, db, meeting)
    return DecisionOut(id=entry.id, state=entry.state, changed=changed)


@router.post("/{entry_id}/reject", response_model=DecisionOut)
async def reject(
    entry_id: int,
    meeting_id: str = PublicMeetingId,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DecisionOut:
    meeting = await run_in_threadpool(_host_meeting, db, meeting_id, user)
    entry, changed = await run_in_threadpool(_decision, wr.reject, db, meeting, entry_id, user.id)
    manager = get_manager()
    if changed:
        await events.notify_rejected(manager, meeting.meeting_id, entry)
        await events.push_host_update(manager, db, meeting)
    return DecisionOut(id=entry.id, state=entry.state, changed=changed)
