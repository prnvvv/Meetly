"""Expected service failures shared by routers and services.

Routers translate these into HTTP responses:

* :class:`InvalidRequestError`  -> 400 (:class:`PermissionDeniedError` -> 403)
* :class:`MeetingNotFoundError` -> 404
* :class:`MeetingConflictError` -> 409
"""

from __future__ import annotations


class ServiceError(Exception):
    """Base class for anticipated, user-facing service failures."""


class InvalidRequestError(ServiceError):
    """The request cannot be honoured as submitted (HTTP 400)."""


class PermissionDeniedError(InvalidRequestError):
    """The caller is authenticated but may not do this (HTTP 403)."""


class MeetingNotFoundError(ServiceError):
    """No meeting matches the supplied public meeting id (HTTP 404)."""


class MeetingConflictError(ServiceError):
    """The operation conflicts with the meeting's current state (HTTP 409)."""


class InvalidPasswordError(ServiceError):
    """The supplied meeting password is incorrect (HTTP 403)."""
