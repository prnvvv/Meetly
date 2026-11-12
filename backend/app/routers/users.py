import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.services import account_email
from app.schemas.user import UserPreferences, UserResponse, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


def _to_response(user: User) -> UserResponse:
    try:
        preferences = json.loads(user.preferences) if user.preferences else {}
    except ValueError:
        preferences = {}
    return UserResponse(
        id=user.id,
        name=user.name,
        email=account_email.get_email(user) or "",
        created_at=user.created_at,
        preferences=UserPreferences.model_validate(preferences),
    )


@router.get("/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user)) -> UserResponse:
    """The authenticated user."""
    return _to_response(user)


@router.patch("/me", response_model=UserResponse)
def update_me(
    payload: UserUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    """Update the caller's own display name and device preferences."""
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Name cannot be empty")
        user.name = name
    if payload.preferences is not None:
        merged = json.loads(user.preferences) if user.preferences else {}
        merged.update(payload.preferences.model_dump(exclude_unset=True))
        user.preferences = json.dumps(merged)
    db.commit()
    db.refresh(user)
    return _to_response(user)
