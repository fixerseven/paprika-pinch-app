import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import Nav from "./Nav";

export const metadata: Metadata = {
  title: "Pinch",
  description: "One place to approve every post.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pinch", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#141517" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/calendar" className="wordmark">
            Pinch
          </Link>
          <Nav />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
