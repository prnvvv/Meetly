"""Errors raised by the social services; routers map them via ``status_code``."""


class SocialError(Exception):
    status_code = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class SocialNotFound(SocialError):
    status_code = 404


class SocialForbidden(SocialError):
    status_code = 403


class SocialConflict(SocialError):
    status_code = 409


class SocialTooSoon(SocialError):
    status_code = 429
