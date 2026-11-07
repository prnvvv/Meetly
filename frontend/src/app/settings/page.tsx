"use client";

import { SignInButton, Show } from "@clerk/nextjs";
import { AppShell } from "@/components/layout/AppShell";
import { DeviceSelector } from "@/components/meeting/DeviceSelector";
import { useToast } from "@/components/common/ToastProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDisplayNamePreference } from "@/hooks/useDisplayNamePreference";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { APP_NAME, MAX_DISPLAY_NAME_LENGTH } from "@/lib/constants";
import { getInitials } from "@/lib/utils";
import { useState } from "react";

export default function SettingsPage() {
  const { user: resolvedUser } = useCurrentUser();
  const { displayName, saveDisplayName } = useDisplayNamePreference();
  const { toast } = useToast();
  const media = useMediaDevices();

  const [name, setName] = useState(displayName);
  const [nameError, setNameError] = useState<string | null>(null);

  const submitName = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Enter the name other participants will see.");
      return;
    }
    if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
      setNameError(
        `Keep your name under ${MAX_DISPLAY_NAME_LENGTH} characters.`
      );
      return;
    }
    setNameError(null);
    saveDisplayName(trimmed);
    toast("Display name saved", "success");
  };

  const accountName = resolvedUser?.name ?? "Guest";
  const accountEmail = resolvedUser?.email ?? "";
  const isClerk = resolvedUser?.isClerk ?? false;
  const isGuest = resolvedUser?.isGuest ?? false;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Settings</h1>
          <p className="page-header__subtitle">
            Manage your account, display name, and meeting devices.
          </p>
        </div>
      </div>

      <div className="section__body settings-page">
        <section className="card card--pad" aria-labelledby="settings-account">
          <div className="card__header">
            <h2 className="card__title" id="settings-account">
              Account
            </h2>
          </div>

          <div className="settings__account">
            <div className="avatar avatar--lg" aria-hidden="true">
              {getInitials(accountName)}
            </div>
            <div className="settings__account-info">
              <div className="settings__account-name">{accountName}</div>
              {accountEmail ? (
                <div className="settings__account-email">{accountEmail}</div>
              ) : null}
              <div className="settings__account-status">
                {isClerk ? (
                  <>Signed in with Clerk</>
                ) : isGuest ? (
                  <>Joining as a guest</>
                ) : (
                  <>Using the demo account</>
                )}
              </div>
            </div>
          </div>

          <Show when="signed-out">
            <div className="settings__account-cta">
              <p className="field__hint">
                Sign in to keep your meetings and profile across sessions.
              </p>
              <SignInButton mode="modal">
                <button type="button" className="btn btn--primary">
                  Sign in
                </button>
              </SignInButton>
            </div>
          </Show>

          <Show when="signed-in">
            <p className="field__hint">
              Your name and email come from your Clerk profile. Update them in
              the Clerk account manager.
            </p>
          </Show>
        </section>

        <section className="card card--pad" aria-labelledby="settings-profile">
          <div className="card__header">
            <h2 className="card__title" id="settings-profile">
              Meeting display name
            </h2>
          </div>
          <p className="card__subtitle">
            This is the name shown to other participants when you join a
            meeting. It is stored locally in this browser.
          </p>

          <form className="settings__form" onSubmit={submitName} noValidate>
            <div className="field">
              <label className="field__label" htmlFor="settings-display-name">
                Display name
              </label>
              <input
                id="settings-display-name"
                className={nameError ? "input input--invalid" : "input"}
                value={name}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError(null);
                }}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={
                  nameError ? "settings-display-name-error" : undefined
                }
              />
              {nameError ? (
                <p className="field__error" id="settings-display-name-error">
                  {nameError}
                </p>
              ) : (
                <p className="field__hint">
                  Shown to everyone else in the meeting.
                </p>
              )}
            </div>

            <div>
              <button type="submit" className="btn btn--primary">
                Save display name
              </button>
            </div>
          </form>
        </section>

        <section className="card card--pad" aria-labelledby="settings-devices">
          <div className="card__header">
            <h2 className="card__title" id="settings-devices">
              Audio and video
            </h2>
          </div>
          <p className="card__subtitle">
            These devices are used when you join a meeting. Camera and
            microphone access is requested when you enter a room.
          </p>

          <DeviceSelector
            audioInputDevices={media.audioInputDevices}
            videoInputDevices={media.videoInputDevices}
            audioOutputDevices={media.audioOutputDevices}
            selectedAudioInputId={media.selectedAudioInputId}
            selectedVideoInputId={media.selectedVideoInputId}
            selectedAudioOutputId={media.selectedAudioOutputId}
            canSelectSpeaker={media.canSelectSpeaker}
            onAudioInputChange={media.setAudioInput}
            onVideoInputChange={media.setVideoInput}
            onAudioOutputChange={media.setAudioOutput}
          />

          {media.audioInputDevices.length === 0 &&
          media.videoInputDevices.length === 0 ? (
            <p className="field__hint">
              No devices detected yet. Allow camera and microphone access, then
              reload this page.
            </p>
          ) : null}
        </section>

        <section className="card card--pad" aria-labelledby="settings-about">
          <div className="card__header">
            <h2 className="card__title" id="settings-about">
              About {APP_NAME}
            </h2>
          </div>
          <p className="card__subtitle">
            Video conferencing built with Next.js, FastAPI, WebSocket, and
            WebRTC.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
