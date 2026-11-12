"""End-to-end integration probe against a running backend.

Exercises every REST endpoint and every WebSocket flow the frontend depends on,
including the cases the frontend handles: invalid ids, ended meetings, host
actions, room isolation, reconnect identity and error codes.

Usage: python scripts/e2e_probe.py [base_url] [--token <jwt>]

If --token is provided, it is used as a Bearer token for REST API calls
and included in WebSocket join messages. The backend must be running in
clerk auth mode or the token must be valid for the current configuration.
"""

from __future__ import annotations

import asyncio
import json
import sys
import os

import httpx
import websockets


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append(f"{name} :: {detail}")
        print(f"  FAIL  {name}  {detail}")


def section(title: str) -> None:
    print(f"\n=== {title} ===")


PASSED: list[str] = []
FAILED: list[str] = []

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
WS_BASE = BASE.replace("http://", "ws://").replace("https://", "wss://")
AUTH_TOKEN = os.getenv("AUTH_TOKEN") or (sys.argv[2] if len(sys.argv) > 2 else "")

extra_headers = {"Authorization": f"Bearer {AUTH_TOKEN}"} if AUTH_TOKEN else {}


async def recv_until(ws, wanted: set[str], timeout: float = 5.0) -> list[dict]:
    """Collect messages until one of `wanted` arrives (or timeout)."""
    seen: list[dict] = []
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=deadline - asyncio.get_event_loop().time())
        except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
            return seen
        msg = json.loads(raw)
        seen.append(msg)
        if msg.get("type") in wanted:
            return seen
    return seen


async def recv_all(ws, count: int, timeout: float = 5.0) -> list[dict]:
    out: list[dict] = []
    for _ in range(count):
        try:
            out.append(json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout)))
        except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
            break
    return out


async def drain(ws, timeout: float = 0.6) -> list[dict]:
    out: list[dict] = []
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        try:
            out.append(json.loads(await asyncio.wait_for(ws.recv(), timeout=0.25)))
        except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
            break
    return out


async def main() -> int:
    async with httpx.AsyncClient(base_url=BASE, timeout=20.0, headers=extra_headers) as c:
        # ---------------------------------------------------- users
        section("GET /api/users/me")
        r = await c.get("/api/users/me")
        body = r.json()
        check("users/me returns 200", r.status_code == 200, str(r.status_code))
        check("users/me has id/name/email", {"id", "name", "email"} <= set(body), str(body))
        check("users/me email is demo@example.com", body.get("email") == "demo@example.com", str(body))

        # ---------------------------------------------------- create
        section("POST /api/meetings")
        r = await c.post("/api/meetings", json={"title": "E2E Instant"})
        meeting = r.json()
        check("create returns 201", r.status_code == 201, str(r.status_code))
        mid = meeting.get("meeting_id", "")
        check("meeting_id is 9 digits", len(mid) == 9 and mid.isdigit(), repr(mid))
        check("status is active", meeting.get("status") == "active", str(meeting.get("status")))
        check("response has all 11 contract fields",
              {"id", "meeting_id", "host_id", "title", "description", "start_time",
               "end_time", "duration", "status", "meeting_link", "created_at"} <= set(meeting),
              str(sorted(meeting)))
        check("meeting_id has no leading zero", not mid.startswith("0"), mid)

        # ---------------------------------------------------- read
        section("GET /api/meetings/{id} and error paths")
        r = await c.get(f"/api/meetings/{mid}")
        check("get active meeting 200", r.status_code == 200, str(r.status_code))
        check("get returns same id", r.json().get("meeting_id") == mid, str(r.json()))

        r = await c.get("/api/meetings/000000000")
        check("unknown meeting 404", r.status_code == 404, str(r.status_code))

        r = await c.get("/api/meetings/abc")
        # get_meeting() does not format-validate (only join/delete do), so a
        # malformed id is indistinguishable from an unknown one. The frontend
        # maps 404 to "Meeting not found", which is the right UX.
        check("malformed meeting id 404 on GET (not format-validated)", r.status_code == 404, str(r.status_code))

        r = await c.get("/api/meetings/000000001")
        check("leading-zero meeting id 404 on GET", r.status_code == 404, str(r.status_code))

        # ---------------------------------------------------- join validation
        section("POST /api/meetings/{id}/join")
        r = await c.post(f"/api/meetings/{mid}/join", json={"display_name": "Probe"})
        check("join active meeting 200", r.status_code == 200, str(r.status_code))
        check("join returns the meeting", r.json().get("meeting_id") == mid, str(r.json()))

        # MeetingJoinRequest.display_name is required; both frontend call sites
        # (JoinForm and useMeeting) always send one.
        r = await c.post(f"/api/meetings/{mid}/join", json={})
        check("join without display_name 422", r.status_code == 422, str(r.status_code))

        r = await c.post("/api/meetings/999999999/join", json={"display_name": "Probe"})
        check("join unknown meeting 404", r.status_code == 404, str(r.status_code))

        r = await c.post("/api/meetings/abc/join", json={"display_name": "Probe"})
        check("join malformed id 400", r.status_code == 400, str(r.status_code))

        r = await c.post(f"/api/meetings/{mid}/join", json={"display_name": "x" * 101})
        check("over-long display_name 422", r.status_code == 422, str(r.status_code))

        # ---------------------------------------------------- schedules
        section("POST/GET /api/schedules")
        r = await c.post("/api/schedules", json={
            "title": "E2E Scheduled",
            "description": "probe",
            "start_time": "2099-01-01T10:00:00Z",
            "duration": 45,
        })
        sched = r.json()
        sched_id = sched.get("meeting_id", "")
        check("schedule returns 201", r.status_code == 201, str(r.status_code))
        check("scheduled status is scheduled", sched.get("status") == "scheduled", str(sched.get("status")))
        check("schedule has 9-digit id", len(sched_id) == 9 and sched_id.isdigit(), repr(sched_id))
        check("schedule duration echoed", sched.get("duration") == 45, str(sched.get("duration")))

        r = await c.post("/api/schedules", json={
            "title": "Past", "start_time": "2000-01-01T10:00:00Z", "duration": 30})
        check("past schedule rejected 400", r.status_code == 400, str(r.status_code))

        r = await c.post("/api/schedules", json={
            "title": "Zero", "start_time": "2099-01-01T10:00:00Z", "duration": 0})
        # Duration bounds are enforced by the Pydantic schema, so FastAPI
        # answers 422 before the service sees it. The frontend also blocks
        # these client-side with inline errors.
        check("zero duration rejected 422", r.status_code == 422, str(r.status_code))

        r = await c.post("/api/schedules", json={
            "title": "Too long", "start_time": "2099-01-01T10:00:00Z", "duration": 1441})
        check("duration > 1440 rejected 422", r.status_code == 422, str(r.status_code))

        r = await c.post("/api/schedules", json={
            "title": "Bad duration type", "start_time": "2099-01-01T10:00:00Z", "duration": "thirty"})
        check("non-numeric duration rejected 422", r.status_code == 422, str(r.status_code))

        r = await c.post("/api/schedules", json={
            "title": "", "start_time": "2099-01-01T10:00:00Z", "duration": 30})
        check("empty title rejected 422", r.status_code == 422, str(r.status_code))

        r = await c.post("/api/schedules", json={
            "title": "Naive time", "start_time": "2099-01-01T10:00:00", "duration": 30})
        check("naive start_time still accepted (treated as local) or 422",
              r.status_code in {201, 422}, str(r.status_code))

        r = await c.get("/api/schedules/upcoming")
        check("upcoming 200", r.status_code == 200, str(r.status_code))
        upcoming = r.json()
        check("scheduled meeting appears in upcoming",
              any(m["meeting_id"] == sched_id for m in upcoming), sched_id)

        r = await c.get("/api/schedules/recent")
        check("recent 200", r.status_code == 200, str(r.status_code))

        # ---------------------------------------------------- participants REST
        section("participants REST")
        r = await c.get(f"/api/meetings/{mid}/participants")
        check("list participants 200", r.status_code == 200, str(r.status_code))
        check("empty list initially", r.json() == [], str(r.json()))

        r = await c.post(f"/api/meetings/{mid}/participants", json={"display_name": "RestUser"})
        check("add participant 201", r.status_code == 201, str(r.status_code))
        rest_p = r.json()
        check("participant meeting_id is an int",
              isinstance(rest_p.get("meeting_id"), int), repr(rest_p.get("meeting_id")))
        check("participant joined_at nullable",
              rest_p.get("joined_at") is None, repr(rest_p.get("joined_at")))
        check("participant left_at nullable",
              rest_p.get("left_at") is None, repr(rest_p.get("left_at")))
        check("participant has is_host", isinstance(rest_p.get("is_host"), bool), str(rest_p))

        r = await c.post(f"/api/meetings/{mid}/participants", json={"display_name": "x" * 101})
        check("over-long participant name 422", r.status_code == 422, str(r.status_code))

        r = await c.get("/api/meetings/000000000/participants")
        check("participants of unknown meeting 404", r.status_code == 404, str(r.status_code))

        r = await c.delete(f"/api/participants/{rest_p['id']}")
        check("delete participant 204", r.status_code == 204, str(r.status_code))

        r = await c.delete("/api/participants/99999999")
        check("delete unknown participant 404", r.status_code == 404, str(r.status_code))

        r = await c.get(f"/api/meetings/{mid}/participants")
        check("deleted participant has left_at set",
              r.json() and r.json()[0]["left_at"] is not None, str(r.json()))

        # ---------------------------------------------------- CORS
        section("CORS")
        r = await c.options("/api/users/me", headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET"})
        check("allowed origin gets allow-origin",
              r.headers.get("access-control-allow-origin") == "http://localhost:3000",
              str(dict(r.headers)))

        r = await c.options("/api/users/me", headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "GET"})
        check("foreign origin gets no allow-origin",
              "access-control-allow-origin" not in r.headers, str(dict(r.headers)))

        # ==================================================== WEBSOCKET
        section("WebSocket: join + broadcast")
        url = f"{WS_BASE}/ws/meetings/{mid}"
        host = await websockets.connect(url)
        await host.send(json.dumps({"type": "join", "meeting_id": mid,
                                    "participant_id": None, "display_name": "HostUser",
                                    "token": AUTH_TOKEN}))
        msgs = await recv_until(host, {"joined", "error"})
        joined = next((m for m in msgs if m["type"] == "joined"), None)
        check("host receives joined", joined is not None, str(msgs))
        host_pid = joined["participant_id"] if joined else None
        check("joined carries participants list", isinstance(joined.get("participants"), list), str(joined))

        guest = await websockets.connect(url)
        await guest.send(json.dumps({"type": "join", "meeting_id": mid,
                                     "participant_id": None, "display_name": "GuestUser",
                                     "token": AUTH_TOKEN}))
        gmsgs = await recv_until(guest, {"joined", "error"})
        gjoined = next((m for m in gmsgs if m["type"] == "joined"), None)
        check("guest receives joined", gjoined is not None, str(gmsgs))
        guest_pid = gjoined["participant_id"] if gjoined else None
        check("guest sees host in its joined payload",
              any(p["id"] == host_pid for p in gjoined.get("participants", [])), str(gjoined))

        announced = await recv_until(host, {"participant_joined"})
        pj = next((m for m in announced if m["type"] == "participant_joined"), None)
        check("host is told a participant joined", pj is not None, str(announced))
        if pj:
            check("participant_joined has summary shape",
                  {"id", "display_name", "is_host", "is_muted", "is_video_on"} <= set(pj["participant"]),
                  str(pj))

        section("WebSocket: meeting_state (authoritative host flag)")
        await host.send(json.dumps({"type": "meeting_state", "participant_id": host_pid}))
        st = await recv_until(host, {"meeting_state", "error"})
        state = next((m for m in st if m["type"] == "meeting_state"), None)
        check("meeting_state returned", state is not None, str(st))
        if state:
            check("meeting_state carries is_host", "is_host" in state, str(state))
            check("meeting_state carries connected ids",
                  isinstance(state.get("connected_participant_ids"), list), str(state))
            HOST_IS_HOST = state["is_host"]
            print(f"        [info] first joiner is_host = {HOST_IS_HOST}")

        section("WebSocket: media_state propagation")
        await guest.send(json.dumps({"type": "media_state", "participant_id": guest_pid,
                                      "is_muted": True, "is_video_on": False}))
        upd = await recv_until(host, {"participant_updated", "error"})
        mu = next((m for m in upd if m["type"] == "participant_updated"), None)
        check("media_state broadcasts participant_updated", mu is not None, str(upd))
        if mu:
            check("update targets the right participant",
                  mu["participant"]["id"] == guest_pid, str(mu))
            check("is_muted persisted in broadcast",
                  mu["participant"].get("is_muted") is True, str(mu))
            check("is_video_on persisted in broadcast",
                  mu["participant"].get("is_video_on") is False, str(mu))

        section("WebSocket: screen_share propagation")
        await guest.send(json.dumps({"type": "screen_share", "participant_id": guest_pid,
                                      "active": True}))
        upd = await recv_until(host, {"participant_updated", "error"})
        ss = next((m for m in upd if m["type"] == "participant_updated"), None)
        check("screen_share broadcasts participant_updated", ss is not None, str(upd))
        if ss:
            check("screen_share flag true", ss["participant"].get("screen_share") is True, str(ss))

        section("WebSocket: signaling routing (offer/answer/ice)")
        await host.send(json.dumps({"type": "offer", "sender_id": host_pid,
                                      "target_id": guest_pid,
                                      "payload": {"type": "offer", "sdp": "v=0-probe"}}))
        got = await recv_until(guest, {"offer", "error"})
        off = next((m for m in got if m["type"] == "offer"), None)
        check("offer routed to target", off is not None, str(got))
        if off:
            check("offer payload untouched", off["payload"] == {"type": "offer", "sdp": "v=0-probe"}, str(off))
            check("offer sender/target echoed",
                  off["sender_id"] == host_pid and off["target_id"] == guest_pid, str(off))

        await guest.send(json.dumps({"type": "answer", "sender_id": guest_pid,
                                      "target_id": host_pid,
                                      "payload": {"type": "answer", "sdp": "v=0-answer"}}))
        got = await recv_until(host, {"answer", "error"})
        check("answer routed back", any(m["type"] == "answer" for m in got), str(got))

        await host.send(json.dumps({"type": "ice_candidate", "sender_id": host_pid,
                                      "target_id": guest_pid,
                                      "payload": {"candidate": "c:probe", "sdpMid": "0",
                                                  "sdpMLineIndex": 0}}))
        got = await recv_until(guest, {"ice_candidate", "error"})
        ice = next((m for m in got if m["type"] == "ice_candidate"), None)
        check("ice candidate routed", ice is not None, str(got))
        if ice:
            check("ice payload untouched",
                  ice["payload"].get("candidate") == "c:probe", str(ice))

        section("WebSocket: spoofing is rejected")
        await guest.send(json.dumps({"type": "media_state", "participant_id": host_pid,
                                      "is_muted": True, "is_video_on": True}))
        errs = await recv_until(guest, {"error"})
        check("cannot spoof another participant_id",
              any(m["type"] == "error" and m["code"] == "UNAUTHORIZED_ACTION" for m in errs), str(errs))

        await guest.send(json.dumps({"type": "offer", "sender_id": host_pid,
                                      "target_id": host_pid, "payload": {"sdp": "x"}}))
        errs = await recv_until(guest, {"error"})
        check("cannot spoof signaling sender_id",
              any(m["type"] == "error" and m["code"] == "UNAUTHORIZED_ACTION" for m in errs), str(errs))

        section("WebSocket: room isolation")
        other = await c.post("/api/meetings", json={"title": "Other Room"})
        other_id = other.json()["meeting_id"]
        ows = await websockets.connect(f"{WS_BASE}/ws/meetings/{other_id}")
        await ows.send(json.dumps({"type": "join", "meeting_id": other_id,
                                    "participant_id": None, "display_name": "Outsider",
                                    "token": AUTH_TOKEN}))
        omsgs = await recv_until(ows, {"joined", "error"})
        ojoined = next((m for m in omsgs if m["type"] == "joined"), None)
        outsider_pid = ojoined["participant_id"] if ojoined else None
        await ows.send(json.dumps({"type": "offer", "sender_id": outsider_pid,
                                     "target_id": guest_pid, "payload": {"sdp": "leak"}}))
        got = await recv_until(guest, {"offer", "error"})
        check("cross-room signaling never reaches target",
              not any(m["type"] == "offer" for m in got), str(got))
        await ows.close()

        section("WebSocket: host controls")
        await guest.send(json.dumps({"type": "mute_participant", "participant_id": guest_pid,
                                      "target_id": host_pid, "is_muted": True}))
        errs = await recv_until(guest, {"error", "host_action"})
        if HOST_IS_HOST:
            acted = any(m["type"] == "host_action" for m in errs)
            check("guest (non-host) is refused a host action", not acted or
                  any(m["type"] == "error" and m["code"] == "NOT_HOST" for m in errs), str(errs))
        else:
            check("non-host receives NOT_HOST",
                  any(m["type"] == "error" and m["code"] == "NOT_HOST" for m in errs), str(errs))

        section("WebSocket: reconnect reuses the participant row")
        await guest.close()
        await asyncio.sleep(0.4)
        again = await websockets.connect(url)
        await again.send(json.dumps({"type": "join", "meeting_id": mid,
                                      "participant_id": guest_pid, "display_name": "GuestUser",
                                      "token": AUTH_TOKEN}))
        rmsgs = await recv_until(again, {"joined", "error"})
        rejoined = next((m for m in rmsgs if m["type"] == "joined"), None)
        check("reconnect rejoins with the same participant id",
              rejoined and rejoined["participant_id"] == guest_pid, str(rmsgs))

        r = await c.get(f"/api/meetings/{mid}/participants")
        rows = r.json()
        active = [p for p in rows if p["left_at"] is None]
        check("no duplicate participant row after reconnect",
              len([p for p in rows if p["display_name"] == "GuestUser"]) == 1, str(rows))
        check("reconnected participant is active again", len(active) >= 2, str(active))

        section("WebSocket: end meeting")
        await host.send(json.dumps({"type": "end_meeting", "participant_id": host_pid}))
        got = await recv_until(again, {"meeting_ended", "error", "meeting_state"})
        if HOST_IS_HOST:
            check("host end_meeting reaches the other participant",
                  any(m["type"] == "meeting_ended" for m in got), str(got))
        else:
            check("non-host end_meeting refused",
                  any(m["type"] == "error" and m["code"] == "NOT_HOST" for m in got), str(got))

        for ws in (host, again):
            try:
                await ws.close()
            except Exception:
                pass

        section("WebSocket: terminal-state rejection")
        r = await c.get(f"/api/meetings/{mid}")
        ended = r.json().get("status")
        print(f"        [info] meeting status after host end = {ended}")
        if ended == "ended":
            w = await websockets.connect(f"{WS_BASE}/ws/meetings/{mid}")
            got = await recv_until(w, {"error"}, timeout=3)
            check("ended meeting socket is refused",
                  any(m["type"] == "error" and m["code"] == "MEETING_ENDED" for m in got), str(got))
            await w.close()
            r = await c.post(f"/api/meetings/{mid}/join", json={"display_name": "Probe"})
            check("REST join on ended meeting 409", r.status_code == 409, str(r.status_code))
        else:
            check("meeting not ended (host controls unreachable)", False,
                  f"status={ended}; host actions unreachable")

        section("WebSocket: unknown meeting and malformed frames")
        # A fresh room: `mid` is ended by the host-control section above.
        fresh = (await c.post("/api/meetings", json={"title": "E2E Fresh"})).json()
        fresh_id = fresh["meeting_id"]
        check("fresh meeting is active", fresh["status"] == "active", str(fresh))

        w = await websockets.connect(f"{WS_BASE}/ws/meetings/000000000")
        got = await recv_until(w, {"error"}, timeout=3)
        check("unknown meeting socket gets MEETING_NOT_FOUND",
              any(m["type"] == "error" and m["code"] == "MEETING_NOT_FOUND" for m in got), str(got))
        await w.close()

        w = await websockets.connect(f"{WS_BASE}/ws/meetings/{fresh_id}")
        await w.send("not json at all")
        got = await recv_until(w, {"error"})
        check("malformed JSON gets INVALID_MESSAGE",
              any(m["type"] == "error" and m["code"] == "INVALID_MESSAGE" for m in got), str(got))
        try:
            await w.send(json.dumps({"type": "totally_unknown"}))
            got = await recv_until(w, {"error"})
            check("unknown message type gets INVALID_MESSAGE",
                  any(m["type"] == "error" and m["code"] == "INVALID_MESSAGE" for m in got), str(got))
            await w.send(json.dumps({"type": "media_state", "participant_id": 1,
                                      "is_muted": True, "is_video_on": True}))
            got = await recv_until(w, {"error"})
            check("action before join gets NOT_A_PARTICIPANT",
                  any(m["type"] == "error" and m["code"] == "NOT_A_PARTICIPANT" for m in got), str(got))
        except websockets.exceptions.ConnectionClosed:
            check("socket stayed open for further invalid frames", False, "closed early")
        await w.close()

        section("WebSocket: ping/pong keepalive")
        w = await websockets.connect(f"{WS_BASE}/ws/meetings/{fresh_id}")
        await w.send(json.dumps({"type": "ping"}))
        got = await recv_until(w, {"pong"})
        check("ping answered with pong", any(m["type"] == "pong" for m in got), str(got))
        await w.close()

        section("WebSocket: duplicate join on one connection is idempotent")
        w = await websockets.connect(f"{WS_BASE}/ws/meetings/{fresh_id}")
        await w.send(json.dumps({"type": "join", "meeting_id": fresh_id,
                                 "participant_id": None, "display_name": "Duper",
                                 "token": AUTH_TOKEN}))
        first = await recv_until(w, {"joined"})
        j1 = next((m for m in first if m["type"] == "joined"), None)
        rows_before = (await c.get(f"/api/meetings/{fresh_id}/participants")).json()
        await w.send(json.dumps({"type": "join", "meeting_id": fresh_id,
                                 "participant_id": j1["participant_id"], "display_name": "Duper",
                                 "token": AUTH_TOKEN}))
        await asyncio.sleep(0.5)
        rows_after = (await c.get(f"/api/meetings/{fresh_id}/participants")).json()
        check("re-join with own id does not create a duplicate row",
              len(rows_after) == len(rows_before), f"{len(rows_before)} -> {len(rows_after)}")
        await w.close()

        section("REST: participant rows match realtime state")
        r = await c.get(f"/api/meetings/{fresh_id}/participants")
        check("GET participants reflects the socket join", len(r.json()) >= 1, str(r.json()))
        for p in r.json():
            check("row meeting_id is the internal int pk",
                  isinstance(p["meeting_id"], int), repr(p["meeting_id"]))
            check("row screen/mute/video flags are booleans",
                  isinstance(p["is_muted"], bool) and isinstance(p["is_video_on"], bool), str(p))
            break

        section("REST: end meeting + history")
        r = await c.delete(f"/api/meetings/{other_id}")
        check("DELETE meeting 200", r.status_code == 200, str(r.status_code))
        check("deleted meeting is ended/cancelled",
              r.json().get("status") in {"ended", "cancelled"}, str(r.json()))
        r = await c.delete(f"/api/meetings/{other_id}")
        check("repeat delete is idempotent (200 by design)", r.status_code == 200, str(r.status_code))
        r = await c.delete("/api/meetings/999999999")
        check("delete unknown meeting 404", r.status_code == 404, str(r.status_code))

    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print(f"PASSED: {len(PASSED)}    FAILED: {len(FAILED)}")
    if FAILED:
        print("\nFailures:")
        for f in FAILED:
            print(f"  - {f}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))