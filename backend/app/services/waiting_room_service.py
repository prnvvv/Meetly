"""Waiting room: durable admission state machine and host decisions.

States and the only legal transitions (everything else raises ``InvalidTransition``):

    WAITING  -> ADMITTED | REJECTED | LEFT
    ADMITTED -> JOINED | LEFT
    JOINED   -> LEFT | REMOVED
    LEFT     -> WAITING            (leaving on purpose means asking again)
    REJECTED, REMOVED              (terminal for this meeting)

Every change is an atomic ``UPDATE ... WHERE state = <expected>``, so two hosts
admitting at once, or a retried request, change the row at most once and the loser
sees "already done" instead of a duplicate transition.

Not persisted here: socket connections and heartbeats. A waiting person whose
connection disappeared for longer than ``STALE_AFTER`` is swept to LEFT when the
host list is read, so crashed tabs do not clutter the lobby.

Rules that keep existing behaviour intact:
* ``meetings.waiting_room_enabled`` defaults to false; nothing here runs for those.
* The host never waits. Anyone who already has a participant row when the host
  turns the waiting room on is grandfathered in (they are not kicked out).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import utc_now
from app.models.meeting import Meeting
from app.models.participant import Participant
from app.models.profile import UserProfile
from app.models.waiting_room import WaitingRoomEntry, WaitingState

S = WaitingState
STALE_AFTER = timedelta(seconds=90)

TRANSITIONS: dict[WaitingState, frozenset[WaitingState]] = {
    S.WAITING: frozenset({S.ADMITTED, S.REJECTED, S.LEFT}),
    S.ADMITTED: frozenset({S.JOINED, S.LEFT}),
    S.JOINED: frozenset({S.LEFT, S.REMOVED}),
    S.LEFT: frozenset({S.WAITING}),
    S.REJECTED: frozenset(),
    S.REMOVED: frozenset(),
}


class InvalidTransition(Exception):
    def __init__(self, current: str, target: str) -> None:
        super().__init__(f"Cannot move from {current} to {target}")
        self.current = current
        self.target = target


class EntryNotFound(Exception):
    pass


@dataclass(frozen=True)
class Admission:
    """What the join handler should do for this user."""

    action: str  # "proceed" | "wait" | "rejected" | "removed"
    entry: WaitingRoomEntry | None = None


def can_transition(current: WaitingState, target: WaitingState) -> bool:
    return target in TRANSITIONS[current]


def _move(
    db: Session,
    entry_id: int,
    expected: WaitingState,
    target: WaitingState,
    *,
    decided_by: int | None = None,
) -> bool:
    """Atomically move one entry; False if it was no longer in ``expected``."""
    if not can_transition(expected, target):
        raise InvalidTransition(expected.value, target.value)
    now = utc_now()
    values: dict = {"state": target.value, "updated_at": now}
    if target in (S.ADMITTED, S.REJECTED, S.REMOVED):
        values.update(decided_at=now, decided_by=decided_by)
    if target is S.ADMITTED:
        values["admitted_at"] = now
    if target is S.WAITING:
        values.update(requested_at=now, decided_at=None, decided_by=None)
    result = db.execute(
        update(WaitingRoomEntry)
        .where(WaitingRoomEntry.id == entry_id, WaitingRoomEntry.state == expected.value)
        .values(**values)
    )
    db.commit()
    return (result.rowcount or 0) == 1


def _entry_for(db: Session, meeting_pk: int, user_id: int) -> WaitingRoomEntry | None:
    return db.scalars(
        select(WaitingRoomEntry).where(
            WaitingRoomEntry.meeting_id == meeting_pk, WaitingRoomEntry.user_id == user_id
        )
    ).first()


def _has_participant_row(db: Session, meeting_pk: int, user_id: int) -> bool:
    return (
        db.scalar(
            select(Participant.id).where(
                Participant.meeting_id == meeting_pk, Participant.user_id == user_id
            )
        )
        is not None
    )


def request_entry(db: Session, meeting: Meeting, user_id: int, display_name: str) -> Admission:
    """Decide what happens when ``user_id`` tries to join ``meeting``."""
    if not meeting.waiting_room_enabled or meeting.host_id == user_id:
        return Admission("proceed")
    name = display_name.strip()[:100] or "Guest"

    for _ in range(3):  # a lost insert race re-reads the winner
        entry = _entry_for(db, meeting.id, user_id)
        if entry is None:
            if _has_participant_row(db, meeting.id, user_id):
                # Already in the meeting before the host switched the waiting room on.
                entry = WaitingRoomEntry(
                    meeting_id=meeting.id, user_id=user_id, display_name=name,
                    state=S.JOINED.value, admitted_at=utc_now(),
                )
                action = "proceed"
            else:
                entry = WaitingRoomEntry(
                    meeting_id=meeting.id, user_id=user_id, display_name=name,
                    state=S.WAITING.value,
                )
                action = "wait"
            try:
                with db.begin_nested():
                    db.add(entry)
                db.commit()
                return Admission(action, entry)
            except IntegrityError:
                db.rollback()
                continue

        state = WaitingState(entry.state)
        if state in (S.ADMITTED, S.JOINED):
            return Admission("proceed", entry)
        if state is S.WAITING:
            if entry.display_name != name:
                entry.display_name = name
                db.commit()
            return Admission("wait", entry)
        if state is S.LEFT:
            if _move(db, entry.id, S.LEFT, S.WAITING):
                entry.display_name = name
                db.commit()
            db.refresh(entry)
            return Admission("wait" if entry.state == S.WAITING.value else "proceed", entry)
        return Admission("rejected" if state is S.REJECTED else "removed", entry)
    raise RuntimeError("Could not resolve waiting room entry")


def mark_joined(db: Session, meeting_pk: int, user_id: int) -> None:
    entry = _entry_for(db, meeting_pk, user_id)
    if entry is not None and entry.state == S.ADMITTED.value:
        _move(db, entry.id, S.ADMITTED, S.JOINED)


def mark_left(db: Session, meeting_pk: int, user_id: int) -> bool:
    """Explicit leave (not a dropped connection). Returns True if the row changed."""
    entry = _entry_for(db, meeting_pk, user_id)
    if entry is None:
        return False
    state = WaitingState(entry.state)
    if state in (S.WAITING, S.ADMITTED, S.JOINED):
        return _move(db, entry.id, state, S.LEFT)
    return False


def mark_left_if_waiting(db: Session, meeting_pk: int, user_id: int) -> bool:
    """A waiting connection dropped: give up the place, but never undo an admission."""
    entry = _entry_for(db, meeting_pk, user_id)
    if entry is not None and entry.state == S.WAITING.value:
        return _move(db, entry.id, S.WAITING, S.LEFT)
    return False


def mark_removed(db: Session, meeting_pk: int, user_id: int) -> bool:
    """Host removed a joined participant: they cannot get back in on their own."""
    entry = _entry_for(db, meeting_pk, user_id)
    if entry is not None and entry.state == S.JOINED.value:
        return _move(db, entry.id, S.JOINED, S.REMOVED)
    return False


def _get_in_meeting(db: Session, meeting_pk: int, entry_id: int) -> WaitingRoomEntry:
    entry = db.get(WaitingRoomEntry, entry_id)
    if entry is None or entry.meeting_id != meeting_pk:
        raise EntryNotFound()
    return entry


def admit(db: Session, meeting: Meeting, entry_id: int, host_id: int) -> tuple[WaitingRoomEntry, bool]:
    """Admit one person. Returns (entry, changed); admitting twice is a harmless no-op."""
    entry = _get_in_meeting(db, meeting.id, entry_id)
    if entry.state == S.ADMITTED.value:
        return entry, False
    changed = _move(db, entry.id, S.WAITING, S.ADMITTED, decided_by=host_id)
    db.refresh(entry)
    if not changed and entry.state not in (S.ADMITTED.value, S.JOINED.value):
        raise InvalidTransition(entry.state, S.ADMITTED.value)
    return entry, changed


def reject(db: Session, meeting: Meeting, entry_id: int, host_id: int) -> tuple[WaitingRoomEntry, bool]:
    entry = _get_in_meeting(db, meeting.id, entry_id)
    if entry.state == S.REJECTED.value:
        return entry, False
    changed = _move(db, entry.id, S.WAITING, S.REJECTED, decided_by=host_id)
    db.refresh(entry)
    if not changed:
        raise InvalidTransition(entry.state, S.REJECTED.value)
    return entry, True


def admit_all(db: Session, meeting: Meeting, host_id: int) -> list[WaitingRoomEntry]:
    """Admit everyone currently waiting; returns only the entries this call changed."""
    waiting = list(
        db.scalars(
            select(WaitingRoomEntry).where(
                WaitingRoomEntry.meeting_id == meeting.id,
                WaitingRoomEntry.state == S.WAITING.value,
            )
        )
    )
    changed = [e for e in waiting if _move(db, e.id, S.WAITING, S.ADMITTED, decided_by=host_id)]
    for e in changed:
        db.refresh(e)
    return changed


def list_waiting(
    db: Session, meeting: Meeting, connected_user_ids: set[int]
) -> list[tuple[WaitingRoomEntry, str | None]]:
    """WAITING entries (oldest first) with the verified @username; sweeps stale ones."""
    now = utc_now()
    rows = list(
        db.scalars(
            select(WaitingRoomEntry)
            .where(
                WaitingRoomEntry.meeting_id == meeting.id,
                WaitingRoomEntry.state == S.WAITING.value,
            )
            .order_by(WaitingRoomEntry.requested_at, WaitingRoomEntry.id)
        )
    )
    live: list[WaitingRoomEntry] = []
    for e in rows:
        if e.user_id not in connected_user_ids and now - e.updated_at > STALE_AFTER:
            _move(db, e.id, S.WAITING, S.LEFT)
        else:
            live.append(e)
    names = {
        p.user_id: p.username
        for p in db.scalars(
            select(UserProfile).where(UserProfile.user_id.in_([e.user_id for e in live]))
        )
    } if live else {}
    return [(e, names.get(e.user_id)) for e in live]


def set_enabled(db: Session, meeting: Meeting, enabled: bool, host_id: int) -> list[WaitingRoomEntry]:
    """Turn the waiting room on/off. Turning it off admits everyone still waiting."""
    meeting.waiting_room_enabled = enabled
    db.commit()
    if enabled:
        return []
    return admit_all(db, meeting, host_id)


def host_name(db: Session, meeting: Meeting) -> str | None:
    profile = db.get(UserProfile, meeting.host_id)
    return profile.display_name if profile else None
