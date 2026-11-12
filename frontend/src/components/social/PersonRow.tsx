import type { ReactNode } from "react";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import type { Person } from "@/types/social";

interface PersonRowProps {
  person: Person;
  onOpen?: (person: Person) => void;
  children?: ReactNode;
}

/** One person in any list: avatar, name, @username and a slot for actions. */
export function PersonRow({ person, onOpen, children }: PersonRowProps) {
  const body = (
    <>
      <ProfileAvatar name={person.display_name} url={person.avatar_url} size={40} />
      <span className="sd-row__text">
        <span className="sd-row__name">{person.display_name}</span>
        <span className="sd-row__sub">
          @{person.username}
          {person.designation ? ` · ${person.designation}` : ""}
        </span>
      </span>
    </>
  );
  return (
    <li className="sd-row">
      {onOpen ? (
        <button
          type="button"
          className="sd-row__main"
          onClick={() => onOpen(person)}
          aria-label={`View ${person.display_name}'s profile`}
        >
          {body}
        </button>
      ) : (
        <div className="sd-row__main sd-row__main--static">{body}</div>
      )}
      {children ? <div className="sd-row__actions">{children}</div> : null}
    </li>
  );
}
