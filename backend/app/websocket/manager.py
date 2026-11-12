from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """In-memory registry of live realtime connections.

    Structure::

        meeting_id
          └── participant_id -> Connection

    Every read/write is scoped by ``meeting_id`` so a message can never be
    delivered to a participant belonging to a different meeting.
    """

    def __init__(self) -> None:
        self._meetings: dict[str, dict[int, Connection]] = {}
        self._screen_sharing: dict[str, set[int]] = {}
        # Waiting-room connections, keyed by USER id (they have no participant yet).
        # Kept apart from ``_meetings`` so nothing broadcast to the room reaches them.
        self._lobby: dict[str, dict[int, WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        websocket: WebSocket,
        *,
        meeting_id: str,
        participant_id: int,
        is_host: bool = False,
    ) -> Connection:
        """Register a connection, closing any stale socket for this participant.

        The endpoint accepts the socket before dispatch, so it is not
        accepted again here: Starlette rejects a second accept.
        """

        async with self._lock:
            meeting = self._meetings.setdefault(meeting_id, {})
            stale = meeting.get(participant_id)
            connection = Connection(
                meeting_id=meeting_id,
                participant_id=participant_id,
                websocket=websocket,
                is_host=is_host,
            )
            meeting[participant_id] = connection

        if stale is not None and stale.websocket is not websocket:
            await self._safe_close(stale.websocket)
            logger.info(
                "Replaced stale connection participant=%s meeting=%s",
                participant_id,
                meeting_id,
            )
        return connection

    async def disconnect(
        self,
        meeting_id: str,
        participant_id: int,
        websocket: WebSocket | None = None,
    ) -> Connection | None:
        """Remove a participant's connection.

        When ``websocket`` is given, only that exact socket is removed. A
        reconnect replaces the registered connection, and the old socket's
        delayed cleanup must not tear the new one down.
        """
        async with self._lock:
            meeting = self._meetings.get(meeting_id)
            if not meeting:
                return None
            current = meeting.get(participant_id)
            if websocket is not None and current is not None and current.websocket is not websocket:
                return None
            connection = meeting.pop(participant_id, None)
            if not meeting:
                self._meetings.pop(meeting_id, None)
            sharers = self._screen_sharing.get(meeting_id)
            if sharers is not None:
                sharers.discard(participant_id)
                if not sharers:
                    self._screen_sharing.pop(meeting_id, None)
        return connection

    async def send_to_participant(
        self,
        meeting_id: str,
        participant_id: int,
        message: dict[str, Any],
    ) -> bool:
        async with self._lock:
            meeting = self._meetings.get(meeting_id) or {}
            connection = meeting.get(participant_id)
        if connection is None:
            return False
        return await self._send(connection, message)

    async def broadcast(
        self,
        meeting_id: str,
        message: dict[str, Any],
    ) -> int:
        return await self.broadcast_except(meeting_id, message, exclude=set())

    async def broadcast_except(
        self,
        meeting_id: str,
        message: dict[str, Any],
        exclude: set[int],
    ) -> int:
        """Send ``message`` to every connection in ``meeting_id`` except ``exclude``."""
        async with self._lock:
            meeting = self._meetings.get(meeting_id) or {}
            targets = [
                connection
                for participant_id, connection in meeting.items()
                if participant_id not in exclude
            ]

        delivered = 0
        dead: list[int] = []
        for connection in targets:
            if await self._send(connection, message):
                delivered += 1
            else:
                dead.append(connection.participant_id)

        for participant_id in dead:
            await self.disconnect(meeting_id, participant_id)

        return delivered

    # -- waiting room ------------------------------------------------------

    async def lobby_add(self, meeting_id: str, user_id: int, websocket: WebSocket) -> None:
        """Register a waiting user; a newer socket for the same user replaces the old."""
        async with self._lock:
            previous = self._lobby.setdefault(meeting_id, {}).get(user_id)
            self._lobby[meeting_id][user_id] = websocket
        if previous is not None and previous is not websocket:
            await self._safe_close(previous)

    async def lobby_remove(self, meeting_id: str, user_id: int, websocket: WebSocket) -> bool:
        """Remove only if ``websocket`` is still the registered one (reconnect safe)."""
        async with self._lock:
            lobby = self._lobby.get(meeting_id)
            if not lobby or lobby.get(user_id) is not websocket:
                return False
            lobby.pop(user_id, None)
            if not lobby:
                self._lobby.pop(meeting_id, None)
            return True

    async def lobby_send(self, meeting_id: str, user_id: int, message: dict[str, Any]) -> bool:
        async with self._lock:
            websocket = (self._lobby.get(meeting_id) or {}).get(user_id)
        if websocket is None:
            return False
        try:
            await websocket.send_json(message)
            return True
        except Exception:
            return False

    async def lobby_close(self, meeting_id: str, user_id: int) -> None:
        """Forget and close a waiting user socket (rejected, meeting ended)."""
        async with self._lock:
            lobby = self._lobby.get(meeting_id) or {}
            websocket = lobby.pop(user_id, None)
            if not lobby:
                self._lobby.pop(meeting_id, None)
        if websocket is not None:
            await self._safe_close(websocket)

    async def lobby_user_ids(self, meeting_id: str) -> set[int]:
        async with self._lock:
            return set(self._lobby.get(meeting_id) or {})

    async def send_to_hosts(self, meeting_id: str, message: dict[str, Any]) -> int:
        """Deliver to host connections only (waiting-room details are host-private)."""
        async with self._lock:
            targets = [c for c in (self._meetings.get(meeting_id) or {}).values() if c.is_host]
        delivered = 0
        for connection in targets:
            if await self._send(connection, message):
                delivered += 1
        return delivered

    async def is_connected(self, meeting_id: str, participant_id: int) -> bool:
        async with self._lock:
            return participant_id in self._meetings.get(meeting_id, {})

    async def disconnect_and_close(
        self,
        meeting_id: str,
        participant_id: int,
    ) -> Connection | None:
        """Remove a connection and close its socket (host removal, meeting end)."""
        connection = await self.disconnect(meeting_id, participant_id)
        if connection is not None:
            await self._safe_close(connection.websocket)
        return connection

    async def live_meeting_ids(self) -> set[str]:
        """Meetings that currently hold at least one socket (room or waiting room)."""
        async with self._lock:
            return {m for m, c in self._meetings.items() if c} | {
                m for m, c in self._lobby.items() if c
            }

    async def get_meeting_participants(self, meeting_id: str) -> list[int]:
        async with self._lock:
            meeting = self._meetings.get(meeting_id) or {}
            return list(meeting.keys())

    async def get_meeting_connections(self, meeting_id: str) -> list[Connection]:
        async with self._lock:
            meeting = self._meetings.get(meeting_id) or {}
            return list(meeting.values())

    async def set_screen_share(
        self,
        meeting_id: str,
        participant_id: int,
        active: bool,
    ) -> bool:
        async with self._lock:
            sharers = self._screen_sharing.setdefault(meeting_id, set())
            if active:
                sharers.add(participant_id)
                return True
            was_active = participant_id in sharers
            sharers.discard(participant_id)
            return was_active

    def is_sharing_screen(self, meeting_id: str, participant_id: int) -> bool:
        sharers = self._screen_sharing.get(meeting_id)
        return bool(sharers and participant_id in sharers)

    async def close_meeting(self, meeting_id: str) -> int:
        """Close and forget every connection in a meeting."""
        connections = await self.get_meeting_connections(meeting_id)
        for connection in connections:
            await self._safe_close(connection.websocket)
        async with self._lock:
            lobby = list((self._lobby.pop(meeting_id, None) or {}).values())
            self._meetings.pop(meeting_id, None)
            self._screen_sharing.pop(meeting_id, None)
        for websocket in lobby:
            await self._safe_close(websocket)
        return len(connections)

    async def _send(self, connection: Connection, message: dict[str, Any]) -> bool:
        try:
            await connection.websocket.send_json(message)
            return True
        except Exception:
            logger.info(
                "Dropping failed send participant=%s meeting=%s",
                connection.participant_id,
                connection.meeting_id,
            )
            return False

    @staticmethod
    async def _safe_close(websocket: WebSocket) -> None:
        try:
            await websocket.close()
        except Exception:
            logger.debug("WebSocket already closed")


class Connection:
    """A single live WebSocket bound to one participant in one meeting."""

    __slots__ = ("meeting_id", "participant_id", "websocket", "is_host", "connected_at")

    def __init__(
        self,
        *,
        meeting_id: str,
        participant_id: int,
        websocket: WebSocket,
        is_host: bool,
    ) -> None:
        self.meeting_id = meeting_id
        self.participant_id = participant_id
        self.websocket = websocket
        self.is_host = is_host
        self.connected_at = datetime.now(timezone.utc)


_manager = ConnectionManager()


def get_manager() -> ConnectionManager:
    """Process-wide connection manager singleton."""
    return _manager