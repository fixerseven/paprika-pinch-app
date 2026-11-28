"use client";

import Link from "next/link";
import { useState } from "react";
import PageTile from "../ui/PageTile";

export interface PickItem {
  slug: string;
  name: string;
  colour: string;
  count: number;
  href: string;
}

/** With many pages, the filter is one button that opens a searchable list instead of a row of tabs. */
export default function PagePicker({ items, current, allHref }: { items: PickItem[]; current?: string; allHref: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const cur = items.find((i) => i.slug === current);
  const shown = items.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <button className="pick" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {cur ? (
          <>
            <PageTile name={cur.name} colour={cur.colour} />
            {cur.name}
          </>
        ) : (
          `All ${items.length} pages`
        )}
        <svg className="i" viewBox="0 0 24 24" aria-hidden>
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Show pages">
            <div className="grab" />
            <h3>Show pages</h3>
            <input className="srch" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages" aria-label="Search pages" />
            {!q && (
              <Link className="pl" href={allHref} aria-current={!current} onClick={() => setOpen(false)}>
                <span />
                <span>All pages</span>
                <span />
              </Link>
            )}
            {shown.map((i) => (
              <Link key={i.slug} className="pl" href={i.href} aria-current={i.slug === current} onClick={() => setOpen(false)}>
                <PageTile name={i.name} colour={i.colour} />
                <span>{i.name}</span>
                <span className="num">{i.count} this week</span>
              </Link>
            ))}
            {!shown.length && <p className="none" style={{ padding: "8px 0" }}>No page matches.</p>}
          </div>
        </>
      )}
    </>
  );
}
