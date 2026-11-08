"use client";

import { useState } from "react";
import { TopNav } from "./TopNav";

/**
 * Application frame: sticky top bar + centered content column. The old
 * left sidebar is gone; its links and quick actions live in the top bar and
 * on the dashboard, exactly like the landing page navigation.
 */
export function AppShell({
  children,
  fit = false,
}: {
  children: React.ReactNode;
  /** Fit content to the viewport on desktop (dashboard); other pages scroll normally. */
  fit?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={fit ? "app-shell app-shell--fit" : "app-shell"}>
      <TopNav
        onMenuToggle={() => setMenuOpen((open) => !open)}
        menuOpen={menuOpen}
        onNavigate={closeMenu}
      />
      <main className="app-main">
        <div className="app-main__inner">{children}</div>
      </main>
    </div>
  );
}
