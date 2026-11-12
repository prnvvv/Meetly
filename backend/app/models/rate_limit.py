from __future__ import annotations

from sqlalchemy import BigInteger, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base


class RateLimitCounter(Base):
    """One fixed-window counter shared by every API instance (see security/ratelimit.py).

    Operational data only: it holds a bucket name, an internal user key and a count, and rows
    expire on their own. Never joined to personal data.
    """

    __tablename__ = "rate_limit_counters"

    bucket: Mapped[str] = mapped_column(String(64), primary_key=True)
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_start: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    hits: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(BigInteger, index=True)
