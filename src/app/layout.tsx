import type { Metadata, Viewport } from "next";
import "./globals.css";
// Design 2026 (Vorschau): Schalter in src/design-2026/flag.ts (false = altes Design).
import "@/design-2026/design-2026.css";
import "@/design-2026/experience.css";
import "@/design-2026/interactions.css";
import { DESIGN_2026 } from "@/design-2026/flag";
import { Inter } from "next/font/google";
const design2026Font = Inter({
  subsets: ["latin"],
  variable: "--font-d26",
  display: "swap",
});
import { ProfileListStateProvider } from "@/components/profile-list-state";
export const metadata: Metadata = {
  title: "ProAcademy · Dein Trainingsportal",
  description:
    "Trainingsplanung, Fortschritt und Berichte für die ProAcademy Familie.",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/favicon-32.png", apple: "/brand/icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0F1A",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="de"
      data-design={DESIGN_2026 ? "2026" : undefined}
      className={design2026Font.variable}
    >
      <body>
        <ProfileListStateProvider>{children}</ProfileListStateProvider>
      </body>
    </html>
  );
}
