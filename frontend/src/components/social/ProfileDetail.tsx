"use client";

import { useEffect, useState } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { ArrowLeftIcon } from "@/components/icons";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { toUserMessage } from "@/lib/api-client";
import { getProfile } from "@/services/profileService";
import type { Profile } from "@/types/profile";
import type { Person } from "@/types/social";
import { RelationshipActions, type PersonAction } from "./RelationshipActions";

interface ProfileDetailProps {
  person: Person;
  onBack: () => void;
  onAction: (action: PersonAction, person: Person) => Promise<void>;
  busy: boolean;
}

/** Another user's profile inside the drawer, exactly as much as the server lets this viewer see. */
export function ProfileDetail({ person, onBack, onAction, busy }: ProfileDetailProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getProfile(person.user_id)
      .then((p) => {
        if (active) setProfile(p);
      })
      .catch((e) => {
        if (active) setError(toUserMessage(e));
      });
    return () => {
      active = false;
    };
  }, [person.user_id]);

  const links = profile?.social_links ? Object.entries(profile.social_links) : [];

  return (
    <div className="sd-detail">
      <button type="button" className="btn btn--ghost btn--sm sd-detail__back" onClick={onBack}>
        <ArrowLeftIcon size={16} /> Back
      </button>
      <div className="sd-detail__head">
        <ProfileAvatar
          name={person.display_name}
          url={profile?.avatar_url ?? person.avatar_url}
          size={72}
        />
        <div>
          <h3 className="sd-detail__name">{profile?.display_name ?? person.display_name}</h3>
          <p className="sd-row__sub">@{person.username}</p>
        </div>
      </div>

      <RelationshipActions person={person} busy={busy} onAction={onAction} />

      {error ? (
        <ErrorState title="Profile unavailable" message={error} />
      ) : !profile ? (
        <p className="field__hint" aria-busy="true">
          Loading profile…
        </p>
      ) : profile.limited ? (
        <p className="sd-note">This profile is shared with friends only.</p>
      ) : (
        <dl className="sd-facts">
          {profile.bio ? <Fact label="About" value={profile.bio} /> : null}
          {profile.designation ? <Fact label="Role" value={profile.designation} /> : null}
          {profile.organization ? <Fact label="Organization" value={profile.organization} /> : null}
          {profile.location ? <Fact label="Location" value={profile.location} /> : null}
          {profile.website ? (
            <div className="sd-fact">
              <dt>Website</dt>
              <dd>
                <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow">
                  {profile.website}
                </a>
              </dd>
            </div>
          ) : null}
          {links.map(([key, url]) => (
            <div className="sd-fact" key={key}>
              <dt>{key[0].toUpperCase() + key.slice(1)}</dt>
              <dd>
                <a href={url} target="_blank" rel="noopener noreferrer nofollow">
                  {url}
                </a>
              </dd>
            </div>
          ))}
          {profile.stats ? (
            <Fact
              label="Meetings"
              value={`${profile.stats.meetings_hosted} hosted · ${profile.stats.meetings_attended} attended`}
            />
          ) : null}
        </dl>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="sd-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
