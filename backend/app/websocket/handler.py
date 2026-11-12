"""Realtime meeting endpoint: signaling routing and meeting state only.

The server never creates peer connections and never receives media. Audio,
video and screen-share streams travel browser-to-browser over WebRTC; this
module only routes SDP/ICE envelopes and maintains realtime meeting state.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database.rls import bind_session as bind_rls
from app.database.session import get_db
from app.auth import AuthError, user_from_token
from app.config import settings
from app.schemas.websocket import (
    AnswerMessage,
    EndMeetingMessage,
    ErrorCode,
    IceCandidateMessage,
    JoinMessage,
    LeaveMessage,
    MediaStateMessage,
    MeetingStateMessage,
    MuteParticipantMessage,
    OfferMessage,
    PingMessage,
    ReactionMessage,
    RemoveParticipantMessage,
    ScreenShareMessage,
    parse_client_message,
)
from app.services import participant_service
from app.services import waiting_room_service
from app.utils.password import verify_password
from app.security.http import origin_allowed
from app.security.ratelimit import limiter
from app.websocket import meeting_gateway, waiting_room_events
from app.websocket.manager import ConnectionManager, get_manager

logger = logging.getLogger(__name__)

router = APIRouter()


class RealtimeSession:
    """Per-connection state established at join time.

    Host status and participant identity are resolved server-side and bound to
    the connection; later client-supplied ids are validated against this
    binding rather than trusted.
    """

    __slots__ = (
        "meeting_id",
        "meeting_pk",
        "user_id",
        "participant_id",
        "is_host",
        "joined",
        "closing",
        "waiting",
    )

    def __init__(self, meeting_id: str) -> None:
        # meeting_id is the public 9-digit id from the URL; meeting_pk is the
        # internal meetings.id that Participant.meeting_id refers to.
        self.meeting_id = meeting_id
        self.meeting_pk: int | None = None
        # Set from the verified token; None only in demo auth mode.
        self.user_id: int | None = None
        self.participant_id: int | None = None
        self.is_host: bool = False
        self.joined: bool = False
        self.closing: bool = False
        # True while this connection sits in the waiting room (not yet in the meeting).
        self.waiting: bool = False


@router.websocket("/ws/meetings/{meeting_id}")
async def meeting_socket(
    websocket: WebSocket,
    meeting_id: str,
    db: Session = Depends(get_db),
) -> None:
    """WS /ws/meetings/{meeting_id} - realtime signaling and state."""
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    await websocket.accept()

    manager = get_manager()
    session = RealtimeSession(meeting_id)

    meeting = await run_in_threadpool(meeting_gateway.get_meeting, db, meeting_id)
    if meeting is None:
        await _send_error(
            websocket,
            ErrorCode.MEETING_NOT_FOUND,
            "Meeting does not exist",
        )
        await websocket.close()
        return

    if meeting_gateway.is_ended(meeting):
        await _send_error(websocket, ErrorCode.MEETING_ENDED, "Meeting has ended")
        await websocket.close()
        return

    # A socket can stay open for hours. Never hold a pooled database connection
    # while idle: return it after every unit of work (the session is reusable).
    await run_in_threadpool(db.close)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                await _send_error(
                    websocket,
                    ErrorCode.INVALID_MESSAGE,
                    "Invalid realtime message",
                )
                continue

            try:
                message = parse_client_message(payload)
            except Exception:
                await _send_error(
                    websocket,
                    ErrorCode.INVALID_MESSAGE,
                    "Invalid realtime message",
                )
                continue

            await _dispatch(websocket, session, manager, db, message)
            await run_in_threadpool(db.close)

            if session.closing:
                break

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected meeting=%s", meeting_id)
    except Exception:
        logger.exception("Realtime connection failure meeting=%s", meeting_id)
        await _send_error(
            websocket,
            ErrorCode.INTERNAL_ERROR,
            "An internal error occurred",
        )
    finally:
        await _cleanup(session, manager, db, websocket)


async def _dispatch(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: Any,
) -> None:
    try:
        if isinstance(message, JoinMessage):
            await _handle_join(websocket, session, manager, db, message)
        elif isinstance(message, PingMessage):
            await websocket.send_json({"type": "pong"})
        elif session.waiting and isinstance(message, LeaveMessage):
            await _handle_lobby_leave(websocket, session, manager, db)
        elif not session.joined:
            await _send_error(
                websocket,
                ErrorCode.NOT_A_PARTICIPANT,
                "Join the meeting before sending realtime messages",
            )
        elif isinstance(message, LeaveMessage):
            await _handle_leave(websocket, session, manager, db)
        elif isinstance(message, OfferMessage):
            await _handle_signal(websocket, session, manager, db, message)
        elif isinstance(message, AnswerMessage):
            await _handle_signal(websocket, session, manager, db, message)
        elif isinstance(message, IceCandidateMessage):
            await _handle_signal(websocket, session, manager, db, message)
        elif isinstance(message, MeetingStateMessage):
            await _handle_meeting_state(websocket, session, manager, db, message)
        elif isinstance(message, MediaStateMessage):
            await _handle_media_state(websocket, session, manager, db, message)
        elif isinstance(message, ScreenShareMessage):
            await _handle_screen_share(websocket, session, manager, db, message)
        elif isinstance(message, MuteParticipantMessage):
            await _handle_mute_participant(websocket, session, manager, db, message)
        elif isinstance(message, RemoveParticipantMessage):
            await _handle_remove_participant(websocket, session, manager, db, message)
        elif isinstance(message, EndMeetingMessage):
            await _handle_end_meeting(websocket, session, manager, db)
        elif isinstance(message, ReactionMessage):
            await _handle_reaction(websocket, session, manager, message)
        else:
            await _send_error(
                websocket,
                ErrorCode.INVALID_MESSAGE,
                "Invalid realtime message",
            )
    except Exception:
        logger.exception("Realtime handler failure meeting=%s", session.meeting_id)
        await _send_error(
            websocket,
            ErrorCode.INTERNAL_ERROR,
            "An internal error occurred",
        )


async def _handle_join(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: JoinMessage,
) -> None:
    if message.meeting_id != session.meeting_id:
        await _send_error(
            websocket,
            ErrorCode.MEETING_NOT_FOUND,
            "Meeting does not match the requested endpoint",
        )
        return

    meeting = await run_in_threadpool(meeting_gateway.get_meeting, db, session.meeting_id)
    if meeting is None:
        await _send_error(websocket, ErrorCode.MEETING_NOT_FOUND, "Meeting does not exist")
        return
    if meeting_gateway.is_ended(meeting):
        await _send_error(websocket, ErrorCode.MEETING_ENDED, "Meeting has ended")
        session.closing = True
        return
    if not meeting_gateway.is_joinable(meeting):
        await _send_error(websocket, ErrorCode.UNAUTHORIZED_ACTION, "Meeting is not joinable")
        return

    # Identity first: password guesses are only accepted from a verified account, and
    # are limited per account and meeting, so the password cannot be brute-forced.
    user_id: int | None = None
    if settings.auth_mode != "demo":
        try:
            user = await run_in_threadpool(user_from_token, db, message.token or "")
        except AuthError:
            await _send_error(
                websocket, ErrorCode.UNAUTHORIZED_ACTION, "Sign in to join this meeting"
            )
            session.closing = True
            return
        user_id = user.id
        await run_in_threadpool(bind_rls, db, user_id)

    attempt_key = f"{user_id}:{meeting.id}"
    if user_id is not None and limiter.check("ws-join", str(user_id), 60, 60) is not None:
        await _send_error(websocket, ErrorCode.UNAUTHORIZED_ACTION, "Too many join attempts. Wait a moment.")
        return

    password = (message.password or "").strip() or None
    if meeting.password_hash is not None:
        if limiter.peek("ws-password", attempt_key, 10, 600):
            await _send_error(
                websocket, ErrorCode.UNAUTHORIZED_ACTION, "Too many wrong passwords. Try again later."
            )
            return
        ok = await run_in_threadpool(verify_password, password or "", meeting.password_hash)
        if not ok:
            limiter.check("ws-password", attempt_key, 10, 600)  # count the failure
            await _send_error(
                websocket,
                ErrorCode.UNAUTHORIZED_ACTION,
                "Incorrect meeting password",
            )
            return

    if user_id is not None and not await run_in_threadpool(
        _may_enter, db, meeting, user_id
    ):
        await _send_error(
            websocket, ErrorCode.UNAUTHORIZED_ACTION, "This meeting is locked"
        )
        return

    if user_id is not None and getattr(meeting, "waiting_room_enabled", False):
        admission = await run_in_threadpool(
            waiting_room_service.request_entry, db, meeting, user_id, message.display_name
        )
        if admission.action == "wait":
            await _enter_lobby(websocket, session, manager, db, meeting, user_id)
            return
        if admission.action in ("rejected", "removed"):
            await _send_error(
                websocket,
                ErrorCode.NOT_ADMITTED,
                "The host did not let you into this meeting"
                if admission.action == "rejected"
                else "You were removed from this meeting",
            )
            session.closing = True
            return

    existing = await _resolve_participant(
        db,
        meeting=meeting,
        meeting_pk=meeting.id,
        requested_id=message.participant_id,
        display_name=message.display_name,
        user_id=user_id,
    )
    if existing is None:
        await _send_error(
            websocket,
            ErrorCode.NOT_A_PARTICIPANT,
            "Could not resolve a participant for this meeting",
        )
        return

    participant_id, is_host = existing
    session.meeting_pk = meeting.id
    session.user_id = user_id
    session.participant_id = participant_id
    session.is_host = is_host
    session.joined = True
    if session.waiting and user_id is not None:
        session.waiting = False
        await manager.lobby_remove(session.meeting_id, user_id, websocket)
    if user_id is not None and getattr(meeting, "waiting_room_enabled", False):
        await run_in_threadpool(waiting_room_service.mark_joined, db, meeting.id, user_id)

    await manager.connect(
        websocket,
        meeting_id=session.meeting_id,
        participant_id=participant_id,
        is_host=is_host,
    )

    others = await _participants_payload(
        db,
        manager,
        meeting.id,
        exclude=participant_id,
    )

    await websocket.send_json(
        {
            "type": "joined",
            "meeting_id": session.meeting_id,
            "participant_id": participant_id,
            "participants": others,
        }
    )

    # Fetch the participant row so the initial broadcast matches the persisted
    # state (new joiners start mic/camera off until their first media_state).
    joined_participant = await run_in_threadpool(
        participant_service.get_participant, db, participant_id
    )

    await manager.broadcast_except(
        session.meeting_id,
        {
            "type": "participant_joined",
            "participant": {
                "id": participant_id,
                "display_name": message.display_name,
                "is_host": is_host,
                "is_muted": bool(joined_participant.is_muted if joined_participant else True),
                "is_video_on": bool(joined_participant.is_video_on if joined_participant else False),
                "screen_share": bool(joined_participant.screen_share if joined_participant else False),
            },
        },
        exclude={participant_id},
    )

    if is_host and getattr(meeting, "waiting_room_enabled", False):
        await waiting_room_events.push_host_update(manager, db, meeting)


async def _enter_lobby(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    meeting: Any,
    user_id: int,
) -> None:
    """Park this connection in the waiting room and tell the host."""
    session.waiting = True
    session.user_id = user_id
    session.meeting_pk = meeting.id
    await manager.lobby_add(session.meeting_id, user_id, websocket)
    host_name = await run_in_threadpool(waiting_room_service.host_name, db, meeting)
    await websocket.send_json(
        {"type": "waiting", "meeting": {"title": meeting.title, "host_name": host_name}}
    )
    await waiting_room_events.push_host_update(manager, db, meeting)


async def _handle_lobby_leave(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
) -> None:
    """A waiting person chose to leave."""
    meeting = await run_in_threadpool(meeting_gateway.get_meeting, db, session.meeting_id)
    if session.user_id is not None and session.meeting_pk is not None:
        await manager.lobby_remove(session.meeting_id, session.user_id, websocket)
        await run_in_threadpool(
            waiting_room_service.mark_left, db, session.meeting_pk, session.user_id
        )
    session.waiting = False
    session.closing = True
    if meeting is not None:
        await waiting_room_events.push_host_update(manager, db, meeting)
    await websocket.close()


async def _resolve_participant(
    db: Session,
    *,
    meeting: Any,
    meeting_pk: int,
    requested_id: int | None,
    display_name: str,
    user_id: int | None = None,
) -> tuple[int, bool] | None:
    """Bind a connection to a participant row, creating or reviving one as needed.

    ``meeting_pk`` is the internal ``meetings.id``. Host status comes from the
    meeting row, never from the client payload. With an authenticated user the
    row is found (or created) by ``(meeting, user_id)`` so one person never has
    two participant rows, and a client cannot claim someone else's row by id.
    """
    if user_id is not None:
        participant = await run_in_threadpool(
            participant_service.find_user_participant, db, meeting_pk, user_id
        )
        if participant is not None:
            if participant.left_at is not None:
                participant.left_at = None
                participant.screen_share = False
                await run_in_threadpool(db.commit)
            is_host = meeting_gateway.is_host_participant(meeting, participant)
            if participant.is_host != is_host:
                await run_in_threadpool(
                    participant_service.set_participant_host, db, participant.id, is_host
                )
            return participant.id, is_host
        try:
            created = await run_in_threadpool(
                participant_service.create_participant,
                db,
                meeting_id=meeting_pk,
                display_name=display_name,
                is_host=meeting_gateway.get_host_id(meeting) == user_id,
                user_id=user_id,
            )
        except IntegrityError:
            # Two simultaneous joins by the same account: the unique index let one
            # win; use that row instead of failing the second connection.
            await run_in_threadpool(db.rollback)
            winner = await run_in_threadpool(
                participant_service.find_user_participant, db, meeting_pk, user_id
            )
            if winner is None:
                raise
            return winner.id, meeting_gateway.is_host_participant(meeting, winner)
        return created.id, created.is_host

    if requested_id is not None:
        participant = await run_in_threadpool(
            participant_service.get_participant, db, requested_id
        )
        if participant is not None:
            if participant.meeting_id != meeting_pk:
                return None
            if participant.left_at is not None:
                participant.left_at = None
                participant.screen_share = False
                await run_in_threadpool(db.commit)
            is_host = meeting_gateway.is_host_participant(meeting, participant)
            if participant.is_host != is_host:
                await run_in_threadpool(
                    participant_service.set_participant_host, db, participant.id, is_host
                )
            return participant.id, is_host

    created = await run_in_threadpool(
        participant_service.create_participant,
        db,
        meeting_id=meeting_pk,
        display_name=display_name,
        is_host=not await run_in_threadpool(
            participant_service.has_host_participant, db, meeting_pk
        ),
    )
    return created.id, created.is_host


def _may_enter(db: Session, meeting: Any, user_id: int) -> bool:
    """A locked meeting admits only its host and people who already joined."""
    if meeting_gateway.get_host_id(meeting) == user_id:
        return True
    if not meeting_gateway.is_locked(meeting):
        return True
    return participant_service.find_user_participant(db, meeting.id, user_id) is not None


async def _handle_leave(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
) -> None:
    participant_id = session.participant_id
    if participant_id is None:
        return

    await manager.disconnect(session.meeting_id, participant_id, websocket)
    await run_in_threadpool(participant_service.mark_participant_left, db, participant_id)
    if session.user_id is not None and session.meeting_pk is not None:
        await run_in_threadpool(
            waiting_room_service.mark_left, db, session.meeting_pk, session.user_id
        )

    await manager.broadcast(
        session.meeting_id,
        {"type": "participant_left", "participant_id": participant_id},
    )

    session.joined = False
    session.closing = True
    await websocket.close()


async def _handle_signal(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: OfferMessage | AnswerMessage | IceCandidateMessage,
) -> None:
    sender_id = message.sender_id
    if sender_id != session.participant_id:
        await _send_error(
            websocket,
            ErrorCode.UNAUTHORIZED_ACTION,
            "Cannot send signaling messages for another participant",
        )
        return

    target = await run_in_threadpool(
        participant_service.get_participant, db, message.target_id
    )
    # Participant.meeting_id is the internal PK, never the public id.
    if target is None or target.meeting_id != session.meeting_pk:
        await _send_error(
            websocket,
            ErrorCode.TARGET_NOT_FOUND,
            "Target participant is not in this meeting",
        )
        return

    delivered = await manager.send_to_participant(
        session.meeting_id,
        message.target_id,
        {
            "type": message.type,
            "sender_id": sender_id,
            "target_id": message.target_id,
            "payload": message.payload,
        },
    )
    if not delivered:
        await _send_error(
            websocket,
            ErrorCode.TARGET_NOT_FOUND,
            "Target participant is not connected",
        )


async def _handle_meeting_state(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: MeetingStateMessage,
) -> None:
    """Send the requesting participant an authoritative snapshot of the meeting."""
    if message.participant_id != session.participant_id:
        await _send_error(
            websocket,
            ErrorCode.UNAUTHORIZED_ACTION,
            "Cannot request meeting state for another participant",
        )
        return

    meeting = await run_in_threadpool(
        meeting_gateway.get_meeting, db, session.meeting_id
    )
    if meeting is None:
        await _send_error(
            websocket,
            ErrorCode.MEETING_NOT_FOUND,
            "Meeting does not exist",
        )
        return

    participants = await _participants_payload(db, manager, meeting.id)
    connected = await manager.get_meeting_participants(session.meeting_id)

    await websocket.send_json(
        {
            "type": "meeting_state",
            "meeting_id": session.meeting_id,
            "participant_id": session.participant_id,
            "is_host": session.is_host,
            "participants": participants,
            "connected_participant_ids": connected,
        }
    )


async def _handle_media_state(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: MediaStateMessage,
) -> None:
    if message.participant_id != session.participant_id:
        await _send_error(
            websocket,
            ErrorCode.UNAUTHORIZED_ACTION,
            "Cannot update media state for another participant",
        )
        return

    participant = await run_in_threadpool(
        participant_service.update_participant_state,
        db,
        session.participant_id,
        is_muted=message.is_muted,
        is_video_on=message.is_video_on,
    )

    await manager.broadcast(
        session.meeting_id,
        {
            "type": "participant_updated",
            "participant": {
                "id": participant.id,
                "is_muted": participant.is_muted,
                "is_video_on": participant.is_video_on,
            },
        },
    )


async def _handle_screen_share(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: ScreenShareMessage,
) -> None:
    if message.participant_id != session.participant_id:
        await _send_error(
            websocket,
            ErrorCode.UNAUTHORIZED_ACTION,
            "Cannot update screen share for another participant",
        )
        return

    await run_in_threadpool(
        participant_service.update_participant_state,
        db,
        session.participant_id,
        screen_share=message.active,
    )
    await manager.set_screen_share(
        session.meeting_id,
        session.participant_id,
        message.active,
    )

    await manager.broadcast(
        session.meeting_id,
        {
            "type": "participant_updated",
            "participant": {
                "id": session.participant_id,
                "screen_share": message.active,
            },
        },
    )


async def _handle_mute_participant(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: MuteParticipantMessage,
) -> None:
    authorized, target_id = await _authorize_host_action(
        websocket, session, manager, db, message
    )
    if not authorized:
        return

    # Persist before announcing, so the broadcast never disagrees with the row.
    await run_in_threadpool(
        participant_service.update_participant_state,
        db,
        target_id,
        is_muted=message.is_muted,
    )
    await manager.broadcast(
        session.meeting_id,
        {
            "type": "host_action",
            "action": "mute" if message.is_muted else "unmute",
            "target_id": target_id,
        },
    )


async def _handle_remove_participant(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: RemoveParticipantMessage,
) -> None:
    authorized, target_id = await _authorize_host_action(
        websocket, session, manager, db, message
    )
    if not authorized:
        return

    await manager.send_to_participant(
        session.meeting_id,
        target_id,
        {
            "type": "host_action",
            "action": "removed",
            "target_id": target_id,
        },
    )

    await manager.disconnect_and_close(session.meeting_id, target_id)
    removed = await run_in_threadpool(
        participant_service.mark_participant_removed, db, target_id
    )
    if removed is not None and removed.user_id is not None:
        await run_in_threadpool(
            waiting_room_service.mark_removed, db, session.meeting_pk, removed.user_id
        )

    await manager.broadcast(
        session.meeting_id,
        {
            "type": "participant_left",
            "participant_id": target_id,
        },
    )


async def _authorize_host_action(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    message: MuteParticipantMessage | RemoveParticipantMessage,
) -> tuple[bool, int]:
    """Validate sender is host and target belongs to this meeting."""
    if message.participant_id != session.participant_id:
        await _send_error(
            websocket,
            ErrorCode.UNAUTHORIZED_ACTION,
            "Cannot act on behalf of another participant",
        )
        return False, 0

    if not session.is_host:
        await _send_error(websocket, ErrorCode.NOT_HOST, "Only the host can do that")
        return False, 0

    target = await run_in_threadpool(
        participant_service.get_participant, db, message.target_id
    )
    # Participant.meeting_id is the internal PK, never the public id.
    if target is None or target.meeting_id != session.meeting_pk:
        await _send_error(
            websocket,
            ErrorCode.TARGET_NOT_FOUND,
            "Target participant is not in this meeting",
        )
        return False, 0

    return True, target.id


async def _handle_end_meeting(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
) -> None:
    participant = await run_in_threadpool(
        participant_service.get_participant, db, session.participant_id
    )
    # Participant.meeting_id is the internal PK, never the public id.
    if participant is None or participant.meeting_id != session.meeting_pk:
        await _send_error(
            websocket,
            ErrorCode.NOT_A_PARTICIPANT,
            "Participant is not part of this meeting",
        )
        return

    if not session.is_host or not participant.is_host:
        await _send_error(websocket, ErrorCode.NOT_HOST, "Only the host can end the meeting")
        return

    await run_in_threadpool(meeting_gateway.end_meeting, db, session.meeting_id)

    await waiting_room_events.notify_meeting_ended(manager, session.meeting_id)
    await manager.broadcast(
        session.meeting_id,
        {"type": "meeting_ended", "meeting_id": session.meeting_id},
    )
    # close_meeting closes every socket in the meeting (including this one),
    # so we must not call websocket.close() again.
    await manager.close_meeting(session.meeting_id)

    session.closing = True


async def _handle_reaction(
    websocket: WebSocket,
    session: RealtimeSession,
    manager: ConnectionManager,
    message: ReactionMessage,
) -> None:
    """Relay a transient emoji to everyone else in the room.

    The sender is excluded: it renders its own reaction locally, so a single
    click never shows up twice. Nothing is written to the participant row —
    a reaction is ephemeral by contract.
    """
    if message.participant_id != session.participant_id:
        await _send_error(
            websocket,
            ErrorCode.UNAUTHORIZED_ACTION,
            "Cannot react on behalf of another participant",
        )
        return

    await manager.broadcast_except(
        session.meeting_id,
        {
            "type": "reaction",
            "participant_id": message.participant_id,
            "emoji": message.emoji,
        },
        exclude={message.participant_id},
    )


def _clear_left(db: Session, participant_id: int) -> None:
    participant = participant_service.get_participant(db, participant_id)
    if participant is not None and participant.left_at is not None:
        participant.left_at = None
        db.commit()


async def _cleanup(
    session: RealtimeSession,
    manager: ConnectionManager,
    db: Session,
    websocket: WebSocket,
) -> None:
    if session.waiting and session.user_id is not None and session.meeting_pk is not None:
        # Only the socket that is still registered gives up its place; a fast
        # reconnect has already replaced it and must not be marked as left.
        if await manager.lobby_remove(session.meeting_id, session.user_id, websocket):
            await run_in_threadpool(
                waiting_room_service.mark_left_if_waiting, db, session.meeting_pk, session.user_id
            )
            meeting = await run_in_threadpool(
                meeting_gateway.get_meeting, db, session.meeting_id
            )
            if meeting is not None:
                await waiting_room_events.push_host_update(manager, db, meeting)
        session.waiting = False
        return

    if not session.joined or session.participant_id is None:
        return

    connection = await manager.disconnect(
        session.meeting_id,
        session.participant_id,
        websocket,
    )
    # A fast reconnect registers a new connection for this participant while
    # this (older) socket is still cleaning up; do not mark them as left then.
    if connection is not None and not await manager.is_connected(
        session.meeting_id, session.participant_id
    ):
        await run_in_threadpool(
            participant_service.mark_participant_left, db, session.participant_id
        )
        if await manager.is_connected(session.meeting_id, session.participant_id):
            # Reconnected while we were writing: undo so the DB matches reality.
            await run_in_threadpool(_clear_left, db, session.participant_id)
            session.joined = False
            return
        await manager.broadcast(
            session.meeting_id,
            {"type": "participant_left", "participant_id": session.participant_id},
        )
    session.joined = False


async def _participants_payload(
    db: Session,
    manager: ConnectionManager,
    meeting_pk: int,
    *,
    exclude: int | None = None,
) -> list[dict]:
    rows = await run_in_threadpool(
        participant_service.get_meeting_participants,
        db,
        meeting_pk,
        active_only=True,
    )
    payload = []
    for row in rows:
        if exclude is not None and row.id == exclude:
            continue
        payload.append(
            {
                "id": row.id,
                "display_name": row.display_name,
                "is_host": row.is_host,
                "is_muted": row.is_muted,
                "is_video_on": row.is_video_on,
                "screen_share": bool(row.screen_share),
            }
        )
    return payload





async def _send_error(websocket: WebSocket, code: str, message: str) -> None:
    """Emit a contract error event. Never raises, never leaks stack traces."""
    try:
        await websocket.send_json(
            {"type": "error", "code": code, "message": message}
        )
    except Exception:
        logger.debug("Could not deliver error event to client")