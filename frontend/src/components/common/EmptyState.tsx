import type { ReactNode } from "react";
import { InboxIcon } from "@/components/icons";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="state-block">
      <div className="state-block__icon">{icon ?? <InboxIcon size={24} />}</div>
      <div className="state-block__title">{title}</div>
      {description ? <p className="state-block__text">{description}</p> : null}
      {action ? <div className="state-block__actions">{action}</div> : null}
    </div>
  );
}
