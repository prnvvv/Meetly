"""People, friends, blocking and notifications endpoints.

Kept in one module per URL group below to stay small; business rules live in
``app.services``. Every route requires a verified user; the acting user id always
comes from the token, never from the request.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.schemas.social import (
    InvitationAcceptResult,
    InvitationOut,
    InviteRequest,
    InviteResponse,
    MeetingInvitationOut,
    FriendRequestCreate,
    FriendRequestOut,
    FriendRequestResult,
    NotificationPage,
    PersonPage,
)
from app.security.ratelimit import rate_limit
from app.services import (
    block_service,
    friend_service,
    invitation_service,
    notification_service,
    people_service,
)
from app.services.social_errors import SocialError
from app.websocket.user_channel import notify_users

people_router = APIRouter(prefix="/api/users", tags=["people"])
friends_router = APIRouter(prefix="/api/friends", tags=["friends"])
blocks_router = APIRouter(prefix="/api", tags=["blocking"])
notifications_router = APIRouter(prefix="/api/notifications", tags=["notifications"])
invitations_router = APIRouter(prefix="/api", tags=["invitations"])


def _http(exc: SocialError) -> HTTPException:
    return HTTPException(exc.status_code, exc.message)


# ---- people -------------------------------------------------------------------


@people_router.get(
    "/search", response_model=PersonPage, dependencies=[Depends(rate_limit("search", 40, 60))]
)
def search_people(
    q: str = Query(min_length=1, max_length=64),
    limit: int = Query(20, ge=1, le=20),
    offset: int = Query(0, ge=0, le=1000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonPage:
    return people_service.search(db, user.id, q, limit=limit, offset=offset)


@people_router.get(
    "/discover", response_model=PersonPage, dependencies=[Depends(rate_limit("discover", 20, 60))]
)
def discover_people(
    limit: int = Query(20, ge=1, le=20),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonPage:
    return people_service.discover(db, user.id, limit=limit)


# ---- friends ------------------------------------------------------------------


@friends_router.get("", response_model=PersonPage)
def list_friends(
    q: str = Query("", max_length=64),
    limit: int = Query(20, ge=1, le=20),
    offset: int = Query(0, ge=0, le=5000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonPage:
    return friend_service.list_friends(db, user.id, q=q, limit=limit, offset=offset)


@friends_router.get("/requests/incoming", response_model=list[FriendRequestOut])
def incoming_requests(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[FriendRequestOut]:
    return friend_service.list_requests(db, user.id, incoming=True)


@friends_router.get("/requests/outgoing", response_model=list[FriendRequestOut])
def outgoing_requests(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[FriendRequestOut]:
    return friend_service.list_requests(db, user.id, incoming=False)


@friends_router.post(
    "/requests",
    response_model=FriendRequestResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("friend-request", 30, 3600))],
)
def send_request(
    payload: FriendRequestCreate,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendRequestResult:
    try:
        result, touched = friend_service.send_request(db, user.id, payload.user_id)
    except SocialError as exc:
        raise _http(exc) from exc
    if result.status != "PENDING" or result.friendship_created:
        response.status_code = status.HTTP_200_OK
    notify_users(touched)
    return result


def _respond(action, db: Session, user: User, request_id: int) -> FriendRequestResult:
    try:
        result, touched = action(db, user.id, request_id)
    except SocialError as exc:
        raise _http(exc) from exc
    notify_users(touched)
    return result


@friends_router.post("/requests/{request_id}/accept", response_model=FriendRequestResult)
def accept_request(
    request_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> FriendRequestResult:
    return _respond(friend_service.accept, db, user, request_id)


@friends_router.post("/requests/{request_id}/reject", response_model=FriendRequestResult)
def reject_request(
    request_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> FriendRequestResult:
    return _respond(friend_service.reject, db, user, request_id)


@friends_router.delete("/requests/{request_id}", response_model=FriendRequestResult)
def cancel_request(
    request_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> FriendRequestResult:
    return _respond(friend_service.cancel, db, user, request_id)


@friends_router.delete("/{friend_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def remove_friend(
    friend_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    try:
        friend_service.remove_friend(db, user.id, friend_id)
    except SocialError as exc:
        raise _http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- blocking -----------------------------------------------------------------


@blocks_router.get("/blocks", response_model=PersonPage)
def list_blocked(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> PersonPage:
    return block_service.list_blocked(db, user.id)


@blocks_router.post(
    "/users/{user_id}/block",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(rate_limit("block", 30, 60))],
)
def block_user(
    user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    try:
        touched = block_service.block(db, user.id, user_id)
    except SocialError as exc:
        raise _http(exc) from exc
    notify_users(touched)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@blocks_router.delete("/users/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def unblock_user(
    user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    block_service.unblock(db, user.id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- notifications --------------------------------------------------------------


@notifications_router.get("", response_model=NotificationPage)
def list_notifications(
    limit: int = Query(20, ge=1, le=50),
    before_id: int | None = Query(None, ge=1),
    unread_only: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationPage:
    return notification_service.list_for(
        db, user.id, limit=limit, before_id=before_id, unread_only=unread_only
    )


@notifications_router.post("/read-all")
def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, int]:
    return {"updated": notification_service.mark_all_read(db, user.id)}


@notifications_router.patch("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def read_one(
    notification_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    try:
        notification_service.mark_read(db, user.id, notification_id)
    except SocialError as exc:
        raise _http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- meeting invitations ----------------------------------------------------------


@invitations_router.post(
    "/meetings/{meeting_id}/invitations",
    response_model=InviteResponse,
    dependencies=[Depends(rate_limit("invite", 30, 60))],
)
def invite_to_meeting(
    meeting_id: str,
    payload: InviteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InviteResponse:
    try:
        result, touched = invitation_service.invite(db, user.id, meeting_id, payload.user_ids)
    except SocialError as exc:
        raise _http(exc) from exc
    notify_users(touched)
    return result


@invitations_router.get("/meetings/{meeting_id}/invitations", response_model=list[MeetingInvitationOut])
def list_meeting_invitations(
    meeting_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[MeetingInvitationOut]:
    try:
        return invitation_service.list_for_meeting(db, user.id, meeting_id)
    except SocialError as exc:
        raise _http(exc) from exc


@invitations_router.get("/invitations", response_model=list[InvitationOut])
def my_invitations(
    pending_only: bool = True,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[InvitationOut]:
    return invitation_service.list_received(db, user.id, pending_only=pending_only)


def _respond_invitation(action, db: Session, user: User, invitation_id: int) -> InvitationAcceptResult:
    try:
        result, touched = action(db, user.id, invitation_id)
    except SocialError as exc:
        raise _http(exc) from exc
    notify_users(touched)
    return result


@invitations_router.post("/invitations/{invitation_id}/accept", response_model=InvitationAcceptResult)
def accept_invitation(
    invitation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> InvitationAcceptResult:
    return _respond_invitation(invitation_service.accept, db, user, invitation_id)


@invitations_router.post("/invitations/{invitation_id}/decline", response_model=InvitationAcceptResult)
def decline_invitation(
    invitation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> InvitationAcceptResult:
    return _respond_invitation(invitation_service.decline, db, user, invitation_id)


@invitations_router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def cancel_invitation(
    invitation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    try:
        touched = invitation_service.cancel(db, user.id, invitation_id)
    except SocialError as exc:
        raise _http(exc) from exc
    notify_users(touched)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


routers = (people_router, friends_router, blocks_router, notifications_router, invitations_router)
