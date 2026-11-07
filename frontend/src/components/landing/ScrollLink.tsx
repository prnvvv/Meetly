"use client";

/** In-page scroll that leaves the URL hash alone (Clerk's hash router owns it). */
export function ScrollLink({
  targetId,
  className,
  children,
}: {
  targetId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() =>
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" })
      }
    >
      {children}
    </button>
  );
}
