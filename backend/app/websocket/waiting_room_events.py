"""Realtime side of the waiting room, shared by the WebSocket handler and REST routes.

Rules: waiting people only ever receive messages about themselves; waiting-room
details (names, usernames) go to host connections only, never to the room.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.models.waiting_room import WaitingRoomEntry
from app.services import waiting_room_service as wr
from app.websocket.manager import ConnectionManager


def entry_payload(entry: WaitingRoomEntry, username: str | None) -> dict[str, Any]:
    return {
        "id": entry.id,
        "display_name": entry.display_name,
        "username": username,
        "requested_at": entry.requested_at.isoformat(),
    }


async def push_host_update(manager: ConnectionManager, db: Session, meeting: Any) -> None:
    """Send the current waiting list (and whether the lobby is on) to the host connections."""
    connected = await manager.lobby_user_ids(meeting.meeting_id)
    rows = await run_in_threadpool(wr.list_waiting, db, meeting, connected)
    await manager.send_to_hosts(
        meeting.meeting_id,
        {
            "type": "waiting_room_updated",
            "enabled": bool(meeting.waiting_room_enabled),
            "entries": [entry_payload(e, name) for e, name in rows],
        },
    )


async def notify_admitted(
    manager: ConnectionManager, meeting_id: str, entries: list[WaitingRoomEntry]
) -> None:
    for entry in entries:
        await manager.lobby_send(meeting_id, entry.user_id, {"type": "admitted"})


async def notify_rejected(
    manager: ConnectionManager, meeting_id: str, entry: WaitingRoomEntry
) -> None:
    """Tell the person, then drop their lobby socket."""
    await manager.lobby_send(meeting_id, entry.user_id, {"type": "rejected"})
    await manager.lobby_close(meeting_id, entry.user_id)


async def notify_meeting_ended(manager: ConnectionManager, meeting_id: str) -> None:
    for user_id in await manager.lobby_user_ids(meeting_id):
        await manager.lobby_send(
            meeting_id, user_id, {"type": "meeting_ended", "meeting_id": meeting_id}
        )
