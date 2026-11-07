import Link from "next/link";
import {
  ArrowRightIcon,
  CalendarIcon,
  LinkIcon,
  VideoIcon,
} from "@/components/icons";

const ACTIONS = [
  {
    href: "/new-meeting",
    label: "New Meeting",
    hint: "Start an instant meeting",
    icon: VideoIcon,
  },
  {
    href: "/join",
    label: "Join Meeting",
    hint: "Enter a meeting ID",
    icon: LinkIcon,
  },
  {
    href: "/schedule",
    label: "Schedule Meeting",
    hint: "Plan it for later",
    icon: CalendarIcon,
  },
];

/** Three equal, fully clickable quick-action cards that open the real workflows. */
export function ActionTiles() {
  return (
    <div className="action-cards">
      {ACTIONS.map(({ href, label, hint, icon: Icon }) => (
        <Link key={href} href={href} className="action-card">
          <span className="action-card__icon" aria-hidden="true">
            <Icon size={24} />
          </span>
          <span className="action-card__text">
            <span className="action-card__label">{label}</span>
            <span className="action-card__hint">{hint}</span>
          </span>
          <ArrowRightIcon className="action-card__arrow" size={20} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
