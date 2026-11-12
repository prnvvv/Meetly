"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { Skeleton } from "@/components/common/Skeleton";
import { useToast } from "@/components/common/ToastProvider";
import { AppShell } from "@/components/layout/AppShell";
import { useMyProfile } from "@/hooks/useMyProfile";
import { toUserMessage } from "@/lib/api-client";
import {
  checkUsername,
  removeMyAvatar,
  updateMyProfile,
  uploadMyAvatar,
} from "@/services/profileService";
import {
  SOCIAL_KEYS,
  type Profile,
  type ProfileUpdate,
  type ProfileVisibility,
} from "@/types/profile";
import { ProfileAvatar } from "./ProfileAvatar";

const USERNAME_RE = /^[a-z][a-z0-9_]{2,29}$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const VISIBILITY: { value: ProfileVisibility; label: string; hint: string }[] = [
  { value: "public", label: "Public", hint: "Any signed-in Meetly user can view your profile." },
  {
    value: "friends",
    label: "Friends only",
    hint: "Others see only your name and username; friends see everything.",
  },
  { value: "private", label: "Private", hint: "Only you can see your profile." },
];

interface FormState {
  display_name: string;
  username: string;
  bio: string;
  location: string;
  designation: string;
  organization: string;
  website: string;
  social: Record<string, string>;
}

function toForm(p: Profile): FormState {
  return {
    display_name: p.display_name,
    username: p.username,
    bio: p.bio ?? "",
    location: p.location ?? "",
    designation: p.designation ?? "",
    organization: p.organization ?? "",
    website: p.website ?? "",
    social: Object.fromEntries(SOCIAL_KEYS.map((k) => [k, p.social_links?.[k] ?? ""])),
  };
}

const nullIfEmpty = (v: string) => (v.trim() ? v.trim() : null);

function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ProfilePage() {
  const { profile, setProfile, loading, error, reload } = useMyProfile();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [usernameState, setUsernameState] = useState<{ ok: boolean; message: string | null } | null>(
    null
  );
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (profile) setForm(toForm(profile));
  }, [profile]);

  const typedUsername = form?.username ?? "";
  const savedUsername = profile?.username ?? "";

  // Debounced availability check, only for an edited and well-formed username.
  useEffect(() => {
    if (!savedUsername || typedUsername === savedUsername) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsernameState(null);
      return;
    }
    const candidate = typedUsername.trim().toLowerCase();
    if (!USERNAME_RE.test(candidate)) {
      setUsernameState({
        ok: false,
        message: "Use 3-30 letters, numbers or underscores, starting with a letter.",
      });
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      checkUsername(candidate)
        .then((r) => {
          if (active) {
            setUsernameState({ ok: r.available, message: r.available ? "Username is available." : r.reason });
          }
        })
        .catch(() => {
          if (active) setUsernameState(null);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [typedUsername, savedUsername]);

  const dirty = useMemo(
    () => !!profile && !!form && JSON.stringify(form) !== JSON.stringify(toForm(profile)),
    [profile, form]
  );

  if (loading && !profile) {
    return (
      <AppShell>
        <Header />
        <div className="pf-grid" aria-busy="true">
          <Skeleton className="skeleton--block" style={{ height: 180 }} />
          <Skeleton className="skeleton--block" style={{ height: 420 }} />
        </div>
      </AppShell>
    );
  }
  if (error || !profile || !form) {
    return (
      <AppShell>
        <Header />
        <ErrorState
          title="Could not load your profile"
          message={error ?? "Something went wrong."}
          onRetry={reload}
        />
      </AppShell>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm({ ...form, [key]: value });
    if (fieldError) setFieldError(null);
  };

  const patch = async (body: ProfileUpdate, success?: string) => {
    const next = await updateMyProfile(body);
    setProfile(next);
    if (success) toast(success, "success");
    return next;
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.display_name.trim()) return setFieldError("Enter a display name.");
    if (usernameState && !usernameState.ok) {
      return setFieldError(usernameState.message ?? "Choose another username.");
    }
    setSaving(true);
    try {
      await patch(
        {
          display_name: form.display_name.trim(),
          username: form.username.trim().toLowerCase(),
          bio: nullIfEmpty(form.bio),
          location: nullIfEmpty(form.location),
          designation: nullIfEmpty(form.designation),
          organization: nullIfEmpty(form.organization),
          website: nullIfEmpty(form.website),
          social_links: Object.fromEntries(SOCIAL_KEYS.map((k) => [k, nullIfEmpty(form.social[k])])),
        },
        "Profile saved"
      );
    } catch (e) {
      setFieldError(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) return toast("Image is too large (maximum 2 MB).", "error");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      return toast("Use a PNG, JPEG or WebP image.", "error");
    }
    setAvatarBusy(true);
    try {
      setProfile(await uploadMyAvatar(file));
      toast("Photo updated", "success");
    } catch (e) {
      toast(toUserMessage(e), "error");
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      setProfile(await removeMyAvatar());
      toast("Photo removed", "success");
    } catch (e) {
      toast(toUserMessage(e), "error");
    } finally {
      setAvatarBusy(false);
    }
  };

  const changePrivacy = async (body: ProfileUpdate) => {
    try {
      await patch(body, "Privacy updated");
    } catch (e) {
      toast(toUserMessage(e), "error");
    }
  };

  const visibility = profile.visibility ?? "public";
  const joined = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })
    : null;
  const usernameBad = !!usernameState && !usernameState.ok;

  return (
    <AppShell>
      <Header />
      <div className="pf-grid">
        <section className="card card--pad pf-hero" aria-labelledby="pf-title">
          <ProfileAvatar name={profile.display_name} url={profile.avatar_url} size={96} />
          <div className="pf-hero__info">
            <h2 className="card__title" id="pf-title">
              {profile.display_name}
            </h2>
            <p className="pf-hero__handle">@{profile.username}</p>
            {joined ? <p className="field__hint">Member since {joined}</p> : null}
            <div className="pf-hero__actions">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="pf-file"
                aria-label="Upload profile photo"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={avatarBusy}
                onClick={() => fileRef.current?.click()}
              >
                {avatarBusy ? "Working…" : profile.avatar_url ? "Change photo" : "Upload photo"}
              </button>
              {profile.avatar_url ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={avatarBusy}
                  onClick={() => void removeAvatar()}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <p className="field__hint">PNG, JPEG or WebP, up to 2 MB. It is cropped to a square.</p>
          </div>
        </section>

        <form className="card card--pad pf-form" onSubmit={save} noValidate aria-labelledby="pf-edit">
          <div className="card__header">
            <h2 className="card__title" id="pf-edit">
              Profile details
            </h2>
          </div>

          <div className="pf-row">
            <TextField
              id="pf-name"
              label="Display name"
              value={form.display_name}
              onChange={(v) => set("display_name", v)}
            />
            <div className="field">
              <label className="field__label" htmlFor="pf-username">
                Username
              </label>
              <input
                id="pf-username"
                className={usernameBad ? "input input--invalid" : "input"}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                aria-describedby="pf-username-hint"
              />
              <p
                id="pf-username-hint"
                className={usernameBad ? "field__error" : "field__hint"}
                aria-live="polite"
              >
                {usernameState?.message ?? "Friends find you by this. Letters, numbers and underscores."}
              </p>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pf-bio">
              Bio
            </label>
            <textarea
              id="pf-bio"
              className="input pf-textarea"
              rows={3}
              maxLength={500}
              value={form.bio}
              onChange={(e) => set("bio", e.target.value)}
            />
            <p className="field__hint pf-count">{form.bio.length}/500</p>
          </div>

          <div className="pf-row">
            <TextField id="pf-designation" label="Designation" value={form.designation} onChange={(v) => set("designation", v)} />
            <TextField id="pf-org" label="Organization" value={form.organization} onChange={(v) => set("organization", v)} />
          </div>
          <div className="pf-row">
            <TextField id="pf-location" label="Location" value={form.location} onChange={(v) => set("location", v)} />
            <TextField id="pf-website" label="Website" placeholder="https://" maxLength={255} value={form.website} onChange={(v) => set("website", v)} />
          </div>

          <fieldset className="pf-social">
            <legend className="field__label">Social links</legend>
            <div className="pf-row">
              {SOCIAL_KEYS.map((key) => (
                <TextField
                  key={key}
                  id={`pf-social-${key}`}
                  label={key[0].toUpperCase() + key.slice(1)}
                  placeholder={`https://${key}.com/…`}
                  maxLength={255}
                  value={form.social[key]}
                  onChange={(v) => set("social", { ...form.social, [key]: v })}
                />
              ))}
            </div>
          </fieldset>

          {fieldError ? (
            <p className="field__error" role="alert">
              {fieldError}
            </p>
          ) : null}
          <div className="pf-actions">
            <button type="submit" className="btn btn--primary" disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            {dirty ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setForm(toForm(profile));
                  setFieldError(null);
                }}
              >
                Discard
              </button>
            ) : null}
          </div>
        </form>

        <section className="card card--pad" aria-labelledby="pf-privacy">
          <div className="card__header">
            <h2 className="card__title" id="pf-privacy">
              Privacy
            </h2>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pf-visibility">
              Who can see your profile
            </label>
            <select
              id="pf-visibility"
              className="select"
              value={visibility}
              onChange={(e) => void changePrivacy({ visibility: e.target.value as ProfileVisibility })}
            >
              {VISIBILITY.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
            <p className="field__hint">{VISIBILITY.find((v) => v.value === visibility)?.hint}</p>
          </div>
          <div className="pf-switch-row">
            <div>
              <div className="field__label">Show my meeting statistics</div>
              <p className="field__hint">Lets people who can see your profile view your meeting counts.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!profile.show_meeting_stats}
              aria-label="Show my meeting statistics"
              className={profile.show_meeting_stats ? "nm-switch nm-switch--on" : "nm-switch"}
              onClick={() => void changePrivacy({ show_meeting_stats: !profile.show_meeting_stats })}
            >
              <span className="nm-switch__thumb" />
            </button>
          </div>
        </section>

        {profile.stats ? (
          <section className="card card--pad" aria-labelledby="pf-stats">
            <div className="card__header">
              <h2 className="card__title" id="pf-stats">
                Your meetings
              </h2>
            </div>
            <dl className="pf-stats">
              <Stat label="Hosted" value={String(profile.stats.meetings_hosted)} />
              <Stat label="Attended" value={String(profile.stats.meetings_attended)} />
              <Stat label="Time hosted" value={formatMinutes(profile.stats.minutes_hosted)} />
            </dl>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function Header() {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header__title">Profile</h1>
        <p className="page-header__subtitle">How you appear to other people on Meetly.</p>
      </div>
    </div>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        className="input"
        maxLength={props.maxLength ?? 100}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pf-stat">
      <dt className="pf-stat__label">{label}</dt>
      <dd className="pf-stat__value">{value}</dd>
    </div>
  );
}
