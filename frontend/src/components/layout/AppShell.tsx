"use client";

import { useState } from "react";
import { TopNav } from "./TopNav";

/**
 * Application frame: sticky top bar + centered content column. The old
 * left sidebar is gone; its links and quick actions live in the top bar and
 * on the dashboard, exactly like the landing page navigation.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
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
