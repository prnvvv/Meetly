import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/styles/primitives.css";
import "@/styles/shell.css";
import "@/styles/dashboard.css";
import "@/styles/workspace.css";
import "@/styles/meeting.css";
import "@/styles/new-meeting.css";
import "@/styles/profile.css";
import "@/styles/social.css";
import "@/styles/waiting-room.css";
import { authLocalization } from "@/lib/clerk-appearance";
import { ToastProvider } from "@/components/common/ToastProvider";

export const metadata: Metadata = {
  title: {
    default: "Meetly",
    template: "%s | Meetly",
  },
  description:
    "Video meetings made simple - start, schedule and join meetings from your browser.",
  icons: {
    icon: "/images/f3.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* Browser extensions (e.g. Grammarly) inject attributes on <body> before hydration. */}
      <body suppressHydrationWarning>
        <ClerkProvider localization={authLocalization}>
          <ToastProvider>{children}</ToastProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
