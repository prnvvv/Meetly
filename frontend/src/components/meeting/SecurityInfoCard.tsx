import { ShieldIcon } from "@/components/icons";

export function SecurityInfoCard() {
  return (
    <div className="nm-security">
      <span className="nm-security__icon">
        <ShieldIcon size={22} />
      </span>
      <div>
        <h3 className="nm-security__title">Meeting Security</h3>
        <p className="nm-security__text">
          Your meeting is private and secure with host controls enabled.
        </p>
      </div>
    </div>
  );
}
