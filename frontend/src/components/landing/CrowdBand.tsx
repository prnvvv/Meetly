import { CROWD_SRC, CrowdCanvas } from "@/components/ui/skiper39";

/**
 * Full-width band that holds the walking-crowd canvas. It lives in normal
 * document flow (the canvas fills the band), so it can never overlap
 * neighbouring content. Pass the height via `className`.
 */
export function CrowdBand({ className = "" }: { className?: string }) {
  return (
    <div className={`relative w-full ${className}`} aria-hidden="true">
      <CrowdCanvas
        src={CROWD_SRC}
        rows={15}
        cols={7}
        scale={1.05}
        fit
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </div>
  );
}
