"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { STORAGE_KEYS } from "@/lib/constants";

export interface MediaDevicesState {
  stream: MediaStream | null;
  /** True once the user explicitly joined audio (microphone live). */
  audioJoined: boolean;
  isMuted: boolean;
  isVideoOn: boolean;
  /** False when no microphone track could be acquired (missing or blocked). */
  audioAvailable: boolean;
  /** False when no camera track could be acquired (missing or blocked). */
  videoAvailable: boolean;
  /** Friendly message when camera/microphone could not be acquired. */
  error: string | null;
  audioInputDevices: MediaDeviceInfo[];
  videoInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedAudioInputId: string | null;
  selectedVideoInputId: string | null;
  selectedAudioOutputId: string | null;
  /** False when the browser cannot route remote audio to a chosen speaker. */
  canSelectSpeaker: boolean;
  /** Refreshes the device list; never prompts for camera or microphone. */
  acquire: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  setAudioInput: (deviceId: string) => void;
  setVideoInput: (deviceId: string) => void;
  setAudioOutput: (deviceId: string) => void;
  /** Requests microphone permission and joins audio on success. */
  joinAudio: () => Promise<boolean>;
  setMuted: (next: boolean) => void;
  /**
   * Turns the camera off synchronously; turning it on resolves once the
   * permission request (if any) has settled.
   */
  setVideoOn: (next: boolean) => Promise<void>;
  stop: () => void;
}

const MEDIA_ERROR =
  "Camera and microphone are unavailable. Others in the meeting cannot see or hear you.";

const CAMERA_BLOCKED =
  "Camera access was blocked. Allow camera access in your browser settings, then try again.";

const MIC_BLOCKED =
  "Microphone access was blocked. Allow microphone access in your browser settings, then try again.";

const DEVICE_BUSY =
  "Your camera or microphone is in use by another application. Close it and try again.";

const DEVICE_GONE =
  "The selected device is no longer available. We switched to the default device.";

const NO_MIC = "No microphone was found. Check your input device and try again.";

const NO_CAMERA = "No camera was found. Check your device and try again.";

/** Plugging in one device can emit a burst of `devicechange` events. */
const DEVICE_CHANGE_DEBOUNCE_MS = 300;

const DEVICE_LABELS: Record<MediaDeviceKind, string> = {
  audioinput: "Microphone",
  audiooutput: "Speaker",
  videoinput: "Camera",
};

/** Browsers hide labels until permission is granted; keep a stable fallback. */
function deviceLabel(device: MediaDeviceInfo, index: number): string {
  const base = DEVICE_LABELS[device.kind] ?? "Device";
  return device.label || `${base} ${index + 1}`;
}

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    /* storage disabled — preferences simply do not persist */
  }
}

function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : "";
}

/** User-facing copy; raw DOMException names never reach the UI. */
function friendlyError(cause: unknown): string {
  switch (errorName(cause)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return CAMERA_BLOCKED;
    case "NotReadableError":
    case "TrackStartError":
      return DEVICE_BUSY;
    case "OverconstrainedError":
    case "NotFoundError":
      return DEVICE_GONE;
    default:
      return MEDIA_ERROR;
  }
}

/** Kind-specific copy for a failed permission/device request. */
function kindError(kind: "audio" | "video", cause: unknown): string {
  switch (errorName(cause)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return kind === "audio" ? MIC_BLOCKED : CAMERA_BLOCKED;
    case "NotReadableError":
    case "TrackStartError":
      return DEVICE_BUSY;
    case "OverconstrainedError":
    case "NotFoundError":
      return kind === "audio" ? NO_MIC : NO_CAMERA;
    default:
      return kind === "audio" ? NO_MIC : friendlyError(cause);
  }
}

/**
 * A successful action clears only its own blocking messages; notices from
 * the other kind (and the "switched to the default device" notice) survive.
 */
const AUDIO_BLOCKING_ERRORS = [MIC_BLOCKED, NO_MIC, DEVICE_BUSY, MEDIA_ERROR];
const VIDEO_BLOCKING_ERRORS = [CAMERA_BLOCKED, NO_CAMERA, DEVICE_BUSY, MEDIA_ERROR];

function clearOwnedError(kind: "audio" | "video") {
  const owned = kind === "audio" ? AUDIO_BLOCKING_ERRORS : VIDEO_BLOCKING_ERRORS;
  return (current: string | null): string | null =>
    current !== null && owned.includes(current) ? null : current;
}

function audioConstraint(deviceId: string | null): MediaTrackConstraints | boolean {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

function videoConstraint(deviceId: string | null): MediaTrackConstraints | boolean {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

function canEnumerate(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.enumerateDevices === "function"
  );
}

function canGetUserMedia(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** `setSinkId` is Chromium-only; elsewhere the speaker list is not offered. */
export function supportsSpeakerSelection(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

/**
 * Local media plus device selection.
 *
 * Nothing is captured until the user acts: `joinAudio()` requests the
 * microphone ("Join Audio") and `setVideoOn(true)` requests the
 * camera. `acquire()` / `refreshDevices()` only enumerate device names.
 * `stop()` releases every track and resets the join flags so a retry
 * starts from the same off-by-default state.
 */
export function useMediaDevices(): MediaDevicesState {
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioJoined, setAudioJoined] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(true);
  const [videoAvailable, setVideoAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoInputDevices, setVideoInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string | null>(() =>
    readStored(STORAGE_KEYS.audioInput)
  );
  const [selectedVideoInputId, setSelectedVideoInputId] = useState<string | null>(() =>
    readStored(STORAGE_KEYS.videoInput)
  );
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string | null>(() =>
    readStored(STORAGE_KEYS.audioOutput)
  );
  // `supportsSpeakerSelection()` reads `HTMLMediaElement.prototype`, which is
  // unavailable during SSR. useSyncExternalStore lets us return false on the
  // server and the real capability on the client without a hydration mismatch.
  const canSelectSpeaker = useSyncExternalStore(
    () => () => {},
    () => supportsSpeakerSelection(),
    () => false
  );

  // Mirrors of state that async code needs to read without re-subscribing.
  const audioInputIdRef = useRef<string | null>(selectedAudioInputId);
  const videoInputIdRef = useRef<string | null>(selectedVideoInputId);
  const audioJoinedRef = useRef(false);
  const mutedRef = useRef(true);
  const videoOnRef = useRef(false);
  const joinPendingRef = useRef(false);
  const cameraPendingRef = useRef(false);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);
  useEffect(() => {
    videoOnRef.current = isVideoOn;
  }, [isVideoOn]);

  const applyDeviceList = useCallback((devices: MediaDeviceInfo[]) => {
    setAudioInputDevices(devices.filter((d) => d.kind === "audioinput"));
    setVideoInputDevices(devices.filter((d) => d.kind === "videoinput"));
    setAudioOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!canEnumerate()) return;
    try {
      applyDeviceList(await navigator.mediaDevices.enumerateDevices());
    } catch {
      /* enumeration is best-effort */
    }
  }, [applyDeviceList]);

  // Initial enumeration runs after the first commit so a room the user leaves
  // immediately never pays for it. It never prompts for permissions.
  useEffect(() => {
    if (!canEnumerate()) return;
    let active = true;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (active) applyDeviceList(devices);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [applyDeviceList]);

  // Device hot-plug is reported by the browser, not polled. Plugging in a
  // webcam can fire `devicechange` several times in a row, so re-enumeration
  // is debounced to a single pass.
  useEffect(() => {
    if (!canEnumerate()) return;
    const media = navigator.mediaDevices;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDeviceChange = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshDevices();
      }, DEVICE_CHANGE_DEBOUNCE_MS);
    };
    media.addEventListener("devicechange", onDeviceChange);
    return () => {
      if (timer !== null) clearTimeout(timer);
      media.removeEventListener("devicechange", onDeviceChange);
    };
  }, [refreshDevices]);

  /**
   * Requests one kind of track for the chosen (or default) device, falling
   * back to the system default when the remembered device disappeared.
   */
  const requestTrack = useCallback(
    async (
      kind: "audio" | "video",
      deviceId: string | null
    ): Promise<MediaStreamTrack> => {
      const request = (id: string | null) => {
        const constraints: MediaStreamConstraints =
          kind === "audio"
            ? { audio: audioConstraint(id) }
            : { video: videoConstraint(id) };
        return navigator.mediaDevices.getUserMedia(constraints);
      };

      try {
        const acquired = await request(deviceId);
        const track = kind === "audio" ? acquired.getAudioTracks()[0] : acquired.getVideoTracks()[0];
        if (track) return track;
        acquired.getTracks().forEach((t) => t.stop());
        throw new Error("track missing");
      } catch (cause: unknown) {
        if (errorName(cause) === "OverconstrainedError" && deviceId) {
          // The remembered device is gone — fall back to system defaults.
          setError(DEVICE_GONE);
          const acquired = await request(null);
          const track = kind === "audio" ? acquired.getAudioTracks()[0] : acquired.getVideoTracks()[0];
          if (track) return track;
          acquired.getTracks().forEach((t) => t.stop());
        }
        throw cause;
      }
    },
    []
  );

  /**
   * Moves a freshly captured track into the active stream. A new MediaStream
   * is published every time so React and the WebRTC hook observe the change
   * and can attach the new track to existing peer connections.
   */
  const mergeTrack = useCallback((track: MediaStreamTrack): MediaStream => {
    const previous = streamRef.current;
    const carried: MediaStreamTrack[] = [];
    if (previous) {
      for (const existing of previous.getTracks()) {
        if (existing.kind === track.kind) {
          existing.stop();
        } else {
          carried.push(existing);
        }
      }
    }
    const next = new MediaStream([...carried, track]);
    streamRef.current = next;
    setStream(next);
    return next;
  }, []);

  // Device lists only — media capture happens on explicit user action.
  const acquire = useCallback(() => refreshDevices(), [refreshDevices]);

  const joinAudio = useCallback(async (): Promise<boolean> => {
    if (audioJoinedRef.current) return true;
    if (joinPendingRef.current) return false;
    if (!canGetUserMedia()) {
      setAudioAvailable(false);
      setError(MEDIA_ERROR);
      return false;
    }
    joinPendingRef.current = true;
    try {
      const track = await requestTrack("audio", audioInputIdRef.current);
      track.enabled = true;
      mergeTrack(track);
      audioJoinedRef.current = true;
      mutedRef.current = false;
      setAudioJoined(true);
      setIsMuted(false);
      setAudioAvailable(true);
      setError(clearOwnedError("audio"));
      void refreshDevices();
      return true;
    } catch (cause: unknown) {
      setAudioAvailable(false);
      setError(kindError("audio", cause));
      return false;
    } finally {
      joinPendingRef.current = false;
    }
  }, [mergeTrack, refreshDevices, requestTrack]);

  /** Brings the camera up: reuses an existing track or requests permission. */
  const turnOnVideo = useCallback(async (): Promise<boolean> => {
    if (videoOnRef.current) return true;
    if (cameraPendingRef.current) return false;

    const existing = streamRef.current?.getVideoTracks()[0];
    if (existing) {
      existing.enabled = true;
      videoOnRef.current = true;
      setIsVideoOn(true);
      return true;
    }

    if (!canGetUserMedia()) {
      setVideoAvailable(false);
      setError(MEDIA_ERROR);
      return false;
    }
    cameraPendingRef.current = true;
    try {
      const track = await requestTrack("video", videoInputIdRef.current);
      track.enabled = true;
      mergeTrack(track);
      videoOnRef.current = true;
      setIsVideoOn(true);
      setVideoAvailable(true);
      setError(clearOwnedError("video"));
      void refreshDevices();
      return true;
    } catch (cause: unknown) {
      setVideoAvailable(false);
      setError(kindError("video", cause));
      return false;
    } finally {
      cameraPendingRef.current = false;
    }
  }, [mergeTrack, refreshDevices, requestTrack]);

  /** Swaps the live microphone for another device, keeping the mute choice. */
  const swapAudioInput = useCallback(
    async (deviceId: string | null): Promise<void> => {
      try {
        const track = await requestTrack("audio", deviceId);
        track.enabled = !mutedRef.current;
        mergeTrack(track);
        setAudioAvailable(true);
        setError(clearOwnedError("audio"));
        void refreshDevices();
      } catch (cause: unknown) {
        setAudioAvailable(false);
        setError(kindError("audio", cause));
      }
    },
    [mergeTrack, refreshDevices, requestTrack]
  );

  /** Swaps the camera for another device, keeping the on/off choice. */
  const swapVideoInput = useCallback(
    async (deviceId: string | null): Promise<void> => {
      try {
        const track = await requestTrack("video", deviceId);
        track.enabled = videoOnRef.current;
        mergeTrack(track);
        setVideoAvailable(true);
        setError(clearOwnedError("video"));
        void refreshDevices();
      } catch (cause: unknown) {
        setVideoAvailable(false);
        setError(kindError("video", cause));
      }
    },
    [mergeTrack, refreshDevices, requestTrack]
  );

  const setAudioInput = useCallback(
    (deviceId: string) => {
      audioInputIdRef.current = deviceId;
      setSelectedAudioInputId(deviceId);
      writeStored(STORAGE_KEYS.audioInput, deviceId);
      // Before Join Audio the choice only applies to the future request.
      if (audioJoinedRef.current) void swapAudioInput(deviceId);
    },
    [swapAudioInput]
  );

  const setVideoInput = useCallback(
    (deviceId: string) => {
      videoInputIdRef.current = deviceId;
      setSelectedVideoInputId(deviceId);
      writeStored(STORAGE_KEYS.videoInput, deviceId);
      // Without a camera track there is nothing to swap; applied on Start Video.
      if (streamRef.current?.getVideoTracks().length) void swapVideoInput(deviceId);
    },
    [swapVideoInput]
  );

  const setAudioOutput = useCallback((deviceId: string) => {
    setSelectedAudioOutputId(deviceId);
    writeStored(STORAGE_KEYS.audioOutput, deviceId);
  }, []);

  const setMuted = useCallback((next: boolean) => {
    // Mute is meaningless before the microphone is joined; joining audio is
    // the only way to bring the mic up (and it starts unmuted).
    if (!audioJoinedRef.current) return;
    mutedRef.current = next;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setIsMuted(next);
  }, []);

  const setVideoOn = useCallback(
    (next: boolean): Promise<void> => {
      if (next) return turnOnVideo().then(() => undefined);
      videoOnRef.current = false;
      streamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
      setIsVideoOn(false);
      return Promise.resolve();
    },
    [turnOnVideo]
  );

  const stop = useCallback(() => {
    const current = streamRef.current;
    streamRef.current = null;
    current?.getTracks().forEach((track) => track.stop());
    // Reset the join flags so a retry starts from the same off-by-default
    // state as the first entry.
    audioJoinedRef.current = false;
    mutedRef.current = true;
    videoOnRef.current = false;
    joinPendingRef.current = false;
    cameraPendingRef.current = false;
    setStream(null);
    setAudioJoined(false);
    setIsMuted(true);
    setIsVideoOn(false);
    setAudioAvailable(true);
    setVideoAvailable(true);
    setError(null);
  }, []);

  return {
    stream,
    audioJoined,
    isMuted,
    isVideoOn,
    audioAvailable,
    videoAvailable,
    error,
    audioInputDevices,
    videoInputDevices,
    audioOutputDevices,
    selectedAudioInputId,
    selectedVideoInputId,
    selectedAudioOutputId,
    canSelectSpeaker,
    acquire,
    refreshDevices,
    setAudioInput,
    setVideoInput,
    setAudioOutput,
    joinAudio,
    setMuted,
    setVideoOn,
    stop,
  };
}

export { deviceLabel };
