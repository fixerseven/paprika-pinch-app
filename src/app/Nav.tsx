"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./ui/Icon";

/** Two tabs. Review and sign-in are full screen, so they hide the bar. */
export default function Nav() {
  const path = usePathname();
  if (path === "/login" || path.startsWith("/review")) return null;
  const onCalendar = path.startsWith("/calendar");
  return (
    <nav className="tabs" aria-label="Screens">
      <Link href="/" className="tab" aria-current={!onCalendar ? "page" : undefined}>
        <Icon name="inbox" />
        Inbox
      </Link>
      <Link href="/calendar" className="tab" aria-current={onCalendar ? "page" : undefined}>
        <Icon name="calendar" />
        Calendar
      </Link>
    </nav>
  );
}
