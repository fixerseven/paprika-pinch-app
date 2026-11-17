"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/review", label: "Review" },
  { href: "/revisions", label: "Sent back" },
  { href: "/calendar", label: "Calendar" },
];

export default function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav aria-label="Screens">
      <span className="nav-soon" title="Coming in phase 3">
        Today
      </span>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path.startsWith(l.href) ? "nav-on" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
