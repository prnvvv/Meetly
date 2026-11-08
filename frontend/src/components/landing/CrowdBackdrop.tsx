import { CROWD_SRC, CrowdCanvas } from "@/components/ui/skiper39";

/**
 * Full-screen white stage with the animated walking crowd along the bottom.
 * Shared by the landing page and the Clerk sign-in / sign-up pages so the
 * whole entry flow feels like one continuous scene.
 */
export function CrowdBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-white text-black">
      <div className="pointer-events-none absolute inset-0">
        <CrowdCanvas src={CROWD_SRC} rows={15} cols={7} />
      </div>
      <div className="relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-10">
        {children}
      </div>
    </main>
  );
}
