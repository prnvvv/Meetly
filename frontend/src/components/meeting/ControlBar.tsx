"use client";

import {
  AutoLayoutIcon,
  CopyIcon,
  GridViewIcon,
  KeyboardIcon,
  MaximizeIcon,
  MinimizeIcon,
  MicIcon,
  MicOffIcon,
  MoreHorizontalIcon,
  EndCallIcon,
  SettingsIcon,
  ShieldIcon,
  SmileIcon,
  SpeakerViewIcon,
  UsersIcon,
  VideoIcon,
  VideoOffIcon,
  ChevronUpIcon,
} from "@/components/icons";
import { EndMeetingButton } from "@/components/meeting/EndMeetingButton";
import {
  CONTROL_ICON_SIZE,
  MediaControlButton,
} from "@/components/meeting/MediaControlButton";
import {
  RoomMenuDivider,
  RoomMenuItem,
  RoomMenuLabel,
  RoomPopover,
} from "@/components/meeting/RoomPopover";
import { ReactionPicker } from "@/components/meeting/ReactionPicker";
import type { RoomLayoutMode } from "@/hooks/useRoomPreferences";

export type SettingsTab = "video" | "audio" | "meeting" | "general";

export interface ControlBarDeviceOptions {
  audioInputDevices: MediaDeviceInfo[];
  videoInputDevices: MediaDeviceInfo[];
  selectedAudioInputId: string | null;
  selectedVideoInputId: string | null;
  setAudioInput: (deviceId: string) => void;
  setVideoInput: (deviceId: string) => void;
}

interface ControlBarProps {
  isMuted: boolean;
  isVideoOn: boolean;
  /** True once the user joined audio; false shows the Join Audio state. */
  audioJoined: boolean;
  /** False when the microphone could not be acquired (blocked or missing). */
  audioAvailable: boolean;
  /** False when the camera could not be acquired (blocked or missing). */
  videoAvailable: boolean;
  /** Microphone permission / capture request in flight. */
  audioPending?: boolean;
  /** Camera permission / capture request in flight. */
  videoPending?: boolean;
  participantsOpen: boolean;
  isHost: boolean;
  layout: RoomLayoutMode;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
  devices: ControlBarDeviceOptions;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleParticipants: () => void;
  onReact: (emoji: string) => void;
  onSetLayout: (layout: RoomLayoutMode) => void;
  onOpenSettings: (tab: SettingsTab) => void;
  onToggleFullscreen: () => void;
  onCopyInvite: () => void;
  /** Host-only actions; undefined hides the whole Host Tools control. */
  onMuteAll?: () => void;
  onEndMeeting?: () => void;
  onLeave: () => void;
}

function deviceName(device: MediaDeviceInfo, index: number): string {
  const base =
    device.kind === "videoinput"
      ? "Camera"
      : device.kind === "audiooutput"
        ? "Speaker"
        : "Microphone";
  return device.label || `${base} ${index + 1}`;
}

/** Bottom control strip of the meeting room (no Chat, by design). */
export function ControlBar({
  isMuted,
  isVideoOn,
  audioJoined,
  audioAvailable,
  videoAvailable,
  audioPending = false,
  videoPending = false,
  participantsOpen,
  isHost,
  layout,
  isFullscreen,
  fullscreenSupported,
  devices,
  onToggleMute,
  onToggleVideo,
  onToggleParticipants,
  onReact,
  onSetLayout,
  onOpenSettings,
  onToggleFullscreen,
  onCopyInvite,
  onMuteAll,
  onEndMeeting,
  onLeave,
}: ControlBarProps) {
  const micLive = audioJoined && audioAvailable;
  const micIcon = micLive && !isMuted ? <MicIcon size={CONTROL_ICON_SIZE} /> : <MicOffIcon size={CONTROL_ICON_SIZE} />;
  const audioName = !audioJoined
    ? "Join Audio"
    : isMuted
      ? "Unmute microphone"
      : "Mute microphone";
  const audioVisible = !audioJoined ? "Join Audio" : isMuted ? "Unmute" : "Mute";

  const videoLive = isVideoOn && videoAvailable;
  const videoVisible = videoLive ? "Stop Video" : "Start Video";

  return (
    <div className="room__controls" role="toolbar" aria-label="Meeting controls">
      <div className="dock">
      <div className="dock__group dock__group--media">
        <RoomPopover
          label="Audio options"
          align="start"
          trigger={(triggerProps) => (
            <>
              <MediaControlButton
                variant="media"
                tone={micLive && !isMuted ? "active" : "off"}
                unavailable={!audioAvailable}
                busy={audioPending}
                icon={micIcon}
                label={audioVisible}
                aria-pressed={audioJoined ? isMuted : undefined}
                aria-label={audioName}
                title={
                  audioAvailable
                    ? audioName
                    : audioJoined
                      ? "Microphone unavailable"
                      : "Microphone unavailable — click to retry"
                }
                onClick={onToggleMute}
              />
              <button
                type="button"
                className="control__caret"
                aria-label="Audio options"
                title="Audio options"
                aria-expanded={triggerProps["aria-expanded"]}
                aria-haspopup={triggerProps["aria-haspopup"]}
                onClick={triggerProps.onToggle}
              >
                <ChevronUpIcon size={13} />
              </button>
            </>
          )}
        >
          {(close) => (
            <>
              <RoomMenuLabel>Microphone</RoomMenuLabel>
              {devices.audioInputDevices.length === 0 ? (
                <div className="room-menu__empty">No microphone detected</div>
              ) : (
                devices.audioInputDevices.map((device, index) => (
                  <RoomMenuItem
                    key={device.deviceId || index}
                    checked={device.deviceId === devices.selectedAudioInputId}
                    onSelect={() => {
                      devices.setAudioInput(device.deviceId);
                      close();
                    }}
                  >
                    {deviceName(device, index)}
                  </RoomMenuItem>
                ))
              )}
              <RoomMenuDivider />
              <RoomMenuItem
                icon={<SettingsIcon size={15} />}
                onSelect={() => {
                  close();
                  onOpenSettings("audio");
                }}
              >
                Audio settings…
              </RoomMenuItem>
            </>
          )}
        </RoomPopover>

        <RoomPopover
          label="Video options"
          align="start"
          trigger={(triggerProps) => (
            <>
              <MediaControlButton
                variant="media"
                tone={videoLive ? "active" : "off"}
                unavailable={!videoAvailable}
                busy={videoPending}
                icon={
                  videoLive ? (
                    <VideoIcon size={CONTROL_ICON_SIZE} />
                  ) : (
                    <VideoOffIcon size={CONTROL_ICON_SIZE} />
                  )
                }
                label={videoVisible}
                aria-pressed={!isVideoOn}
                aria-label={isVideoOn ? "Turn camera off" : "Turn camera on"}
                title={
                  videoAvailable
                    ? isVideoOn
                      ? "Stop video"
                      : "Start video"
                    : "Camera unavailable"
                }
                onClick={onToggleVideo}
              />
              <button
                type="button"
                className="control__caret"
                aria-label="Video options"
                title="Video options"
                aria-expanded={triggerProps["aria-expanded"]}
                aria-haspopup={triggerProps["aria-haspopup"]}
                onClick={triggerProps.onToggle}
              >
                <ChevronUpIcon size={13} />
              </button>
            </>
          )}
        >
          {(close) => (
            <>
              <RoomMenuLabel>Camera</RoomMenuLabel>
              {devices.videoInputDevices.length === 0 ? (
                <div className="room-menu__empty">No camera detected</div>
              ) : (
                devices.videoInputDevices.map((device, index) => (
                  <RoomMenuItem
                    key={device.deviceId || index}
                    checked={device.deviceId === devices.selectedVideoInputId}
                    onSelect={() => {
                      devices.setVideoInput(device.deviceId);
                      close();
                    }}
                  >
                    {deviceName(device, index)}
                  </RoomMenuItem>
                ))
              )}
              <RoomMenuDivider />
              <RoomMenuItem
                icon={<SettingsIcon size={15} />}
                onSelect={() => {
                  close();
                  onOpenSettings("video");
                }}
              >
                Video settings…
              </RoomMenuItem>
            </>
          )}
        </RoomPopover>

      </div>

      <div className="dock__group dock__group--tools">
        <MediaControlButton
          tone={participantsOpen ? "active" : "neutral"}
          icon={<UsersIcon size={CONTROL_ICON_SIZE} />}
          label="Participants"
          aria-pressed={participantsOpen}
          aria-label="Show participants"
          title="Participants"
          onClick={onToggleParticipants}
        />

        <RoomPopover
          label="Reactions"
          className="room-popover-anchor--secondary"
          trigger={(triggerProps) => (
            <MediaControlButton
              secondary
              tone={triggerProps.open ? "active" : "neutral"}
              icon={<SmileIcon size={CONTROL_ICON_SIZE} />}
              label="React"
              aria-label="Open reactions"
              title="React"
              aria-expanded={triggerProps["aria-expanded"]}
              aria-haspopup={triggerProps["aria-haspopup"]}
              onClick={triggerProps.onToggle}
            />
          )}
        >
          {(close) => (
            <ReactionPicker
              onReact={(emoji) => {
                onReact(emoji);
                close();
              }}
            />
          )}
        </RoomPopover>

        {isHost ? (
          <RoomPopover
            label="Host tools"
            className="room-popover-anchor--secondary"
            trigger={(triggerProps) => (
              <MediaControlButton
                secondary
                tone={triggerProps.open ? "active" : "neutral"}
                icon={<ShieldIcon size={CONTROL_ICON_SIZE} />}
                label="Host Tools"
                aria-label="Open host tools"
                title="Host Tools"
                aria-expanded={triggerProps["aria-expanded"]}
                aria-haspopup={triggerProps["aria-haspopup"]}
                onClick={triggerProps.onToggle}
              />
            )}
          >
            {(close) => (
              <>
                <RoomMenuLabel>Host controls</RoomMenuLabel>
                <RoomMenuItem
                  icon={<MicOffIcon size={15} />}
                  onSelect={() => {
                    close();
                    onMuteAll?.();
                  }}
                >
                  Mute everyone
                </RoomMenuItem>
                <RoomMenuItem
                  icon={<UsersIcon size={15} />}
                  onSelect={() => {
                    close();
                    onToggleParticipants();
                  }}
                >
                  Manage participants
                </RoomMenuItem>
                <RoomMenuDivider />
                <RoomMenuItem
                  danger
                  icon={<EndCallIcon size={15} />}
                  onSelect={() => {
                    close();
                    onEndMeeting?.();
                  }}
                >
                  End meeting for all
                </RoomMenuItem>
              </>
            )}
          </RoomPopover>
        ) : null}

        <RoomPopover
          label="More options"
          align="end"
          trigger={(triggerProps) => (
            <MediaControlButton
              tone={triggerProps.open ? "active" : "neutral"}
              icon={<MoreHorizontalIcon size={CONTROL_ICON_SIZE} />}
              label="More"
              aria-label="Open more options"
              title="More"
              aria-expanded={triggerProps["aria-expanded"]}
              aria-haspopup={triggerProps["aria-haspopup"]}
              onClick={triggerProps.onToggle}
            />
          )}
        >
          {(close) => (
            <>
              <div className="room-menu__mobile-only">
                <RoomMenuLabel>React</RoomMenuLabel>
                <ReactionPicker
                  onReact={(emoji) => {
                    onReact(emoji);
                    close();
                  }}
                />
                {isHost ? (
                  <>
                    <RoomMenuDivider />
                    <RoomMenuLabel>Host controls</RoomMenuLabel>
                    <RoomMenuItem
                      icon={<MicOffIcon size={15} />}
                      onSelect={() => {
                        close();
                        onMuteAll?.();
                      }}
                    >
                      Mute everyone
                    </RoomMenuItem>
                  </>
                ) : null}
                <RoomMenuDivider />
              </div>
              <RoomMenuItem
                icon={<SettingsIcon size={15} />}
                onSelect={() => {
                  close();
                  onOpenSettings("general");
                }}
              >
                Settings…
              </RoomMenuItem>
              <RoomMenuItem
                icon={<KeyboardIcon size={15} />}
                onSelect={() => {
                  close();
                  onOpenSettings("general");
                }}
              >
                Keyboard shortcuts
              </RoomMenuItem>
              <RoomMenuDivider />
              <RoomMenuLabel>Layout</RoomMenuLabel>
              <RoomMenuItem
                icon={<AutoLayoutIcon size={15} />}
                checked={layout === "auto"}
                onSelect={() => onSetLayout("auto")}
              >
                Auto
              </RoomMenuItem>
              <RoomMenuItem
                icon={<GridViewIcon size={15} />}
                checked={layout === "gallery"}
                onSelect={() => onSetLayout("gallery")}
              >
                Gallery view
              </RoomMenuItem>
              <RoomMenuItem
                icon={<SpeakerViewIcon size={15} />}
                checked={layout === "speaker"}
                onSelect={() => onSetLayout("speaker")}
              >
                Speaker view
              </RoomMenuItem>
              <RoomMenuDivider />
              {fullscreenSupported ? (
                <RoomMenuItem
                  icon={
                    isFullscreen ? <MinimizeIcon size={15} /> : <MaximizeIcon size={15} />
                  }
                  onSelect={() => {
                    close();
                    onToggleFullscreen();
                  }}
                >
                  {isFullscreen ? "Exit full screen" : "Enter full screen"}
                </RoomMenuItem>
              ) : null}
              <RoomMenuItem icon={<CopyIcon size={15} />} onSelect={onCopyInvite}>
                Copy invite link
              </RoomMenuItem>
              <RoomMenuDivider />
              <RoomMenuItem danger onSelect={onLeave}>
                Leave meeting
              </RoomMenuItem>
              {isHost ? (
                <RoomMenuItem
                  danger
                  className="room-menu__item--mobile"
                  onSelect={() => {
                    close();
                    onEndMeeting?.();
                  }}
                >
                  End meeting for all
                </RoomMenuItem>
              ) : null}
            </>
          )}
        </RoomPopover>
      </div>

      <div className="dock__end">
        <EndMeetingButton onEndMeeting={onEndMeeting} onLeave={onLeave} />
      </div>
      </div>
    </div>
  );
}
