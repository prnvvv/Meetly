from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.schemas.profile import ProfileOut, ProfileUpdate, UsernameAvailability
from app.security.ratelimit import rate_limit
from app.services import profile_service
from app.services.avatar_image import MAX_UPLOAD_BYTES, InvalidImageError
from app.services.profile_service import ProfileNotFoundError, UsernameTakenError
from app.services.storage import StorageUnavailable

router = APIRouter(prefix="/api/users", tags=["profiles"])

TOO_LARGE = "Image is too large (maximum 2 MB)"


@router.get("/me/profile", response_model=ProfileOut)
def get_my_profile(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProfileOut:
    profile = profile_service.ensure_profile(db, user)
    return profile_service.build_view(db, user.id, profile)


@router.patch(
    "/me/profile",
    response_model=ProfileOut,
    dependencies=[Depends(rate_limit("profile-update", 30, 60))],
)
def update_my_profile(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileOut:
    try:
        profile = profile_service.update_profile(db, user, payload)
    except UsernameTakenError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return profile_service.build_view(db, user.id, profile)


@router.get(
    "/username-available",
    response_model=UsernameAvailability,
    dependencies=[Depends(rate_limit("username-check", 60, 60))],
)
def username_available(
    username: str = Query(min_length=1, max_length=64),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UsernameAvailability:
    ok, reason = profile_service.username_status(db, username, own_user_id=user.id)
    return UsernameAvailability(username=username.strip().lower(), available=ok, reason=reason)


@router.put(
    "/me/avatar",
    response_model=ProfileOut,
    dependencies=[Depends(rate_limit("avatar", 10, 60))],
)
async def upload_my_avatar(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileOut:
    """Raw image bytes in the body (PNG/JPEG/WebP, max 2 MB). The type is verified from the bytes."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
        chunks.append(chunk)
    data = b"".join(chunks)

    def work() -> ProfileOut:
        try:
            profile = profile_service.set_avatar(db, user, data)
        except InvalidImageError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
        except StorageUnavailable as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
        return profile_service.build_view(db, user.id, profile)

    return await run_in_threadpool(work)


@router.delete("/me/avatar", response_model=ProfileOut)
def delete_my_avatar(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProfileOut:
    profile = profile_service.remove_avatar(db, user)
    return profile_service.build_view(db, user.id, profile)


@router.get("/{user_id}/profile", response_model=ProfileOut)
def get_user_profile(
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileOut:
    try:
        return profile_service.get_view(db, user.id, user_id)
    except ProfileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found") from exc
