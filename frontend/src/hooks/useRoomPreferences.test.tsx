import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/lib/constants";
import { useRoomPreferences } from "./useRoomPreferences";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("useRoomPreferences", () => {
  it("has no video-crop preference: the whole camera frame is always shown", () => {
    const { result } = renderHook(() => useRoomPreferences());
    expect(Object.keys(result.current.preferences).sort()).toEqual([
      "layout",
      "mirrorSelf",
    ]);
  });

  it("ignores a stale videoFit value stored by older versions", () => {
    window.localStorage.setItem(
      STORAGE_KEYS.roomPrefs,
      JSON.stringify({ layout: "gallery", mirrorSelf: false, videoFit: "fill" })
    );
    const { result } = renderHook(() => useRoomPreferences());
    expect(result.current.preferences).toEqual({
      layout: "gallery",
      mirrorSelf: false,
    });
  });

  it("persists layout choices", () => {
    const first = renderHook(() => useRoomPreferences());
    act(() => first.result.current.setLayout("speaker"));
    first.unmount();
    const second = renderHook(() => useRoomPreferences());
    expect(second.result.current.preferences.layout).toBe("speaker");
  });
});
