import Image from "next/image";

interface DashboardHeroProps {
  /** "Good morning" / "Good afternoon" / "Good evening"; empty until the client clock is known. */
  greeting: string;
  /** Signed-in user's first name, when known. */
  firstName?: string;
  /** Pre-formatted local date; empty until the client clock is known. */
  dateLabel: string;
}

/**
 * Greeting on the left, the hand-drawn people illustration on the right.
 * The text lines reserve their height so nothing jumps once the client clock
 * (and the user's name) arrive.
 */
export function DashboardHero({ greeting, firstName, dateLabel }: DashboardHeroProps) {
  return (
    <section className="dash-hero" aria-labelledby="dash-greeting">
      <div className="dash-hero__text">
        <h1 className="dash-hero__title" id="dash-greeting">
          {greeting}
          {greeting && firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="dash-hero__date">{dateLabel}</p>
      </div>
      <Image
        className="dash-hero__art"
        src="/images/people-illustration-dashboard.png"
        alt=""
        width={1915}
        height={821}
        sizes="(max-width: 900px) 80vw, 480px"
        priority
      />
    </section>
  );
}
