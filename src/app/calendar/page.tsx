import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireApprover } from "@/lib/session";
import { getCalendar, lastImports, listBrands, type CalendarPost } from "@/lib/queries";
import { STATE_LABEL, formatWhen, loudFlags, shortDay } from "@/lib/labels";
import { addDays, todayIn } from "@/lib/time";
import { getReviewStack } from "@/lib/review";

export const dynamic = "force-dynamic";

type Search = Promise<{ brand?: string; past?: string; days?: string }>;

/** Scheduled and posted are the normal case, so they carry no label. Only what needs a look gets words. */
function status(p: CalendarPost, waiting: Set<number>): { text: string; tone?: "due" | "bad" } | null {
  const loud = loudFlags(p.flags)[0];
  if (p.state === "failed") return { text: "Failed", tone: "bad" };
  if (p.missed) return { text: "Missed", tone: "bad" };
  if (loud) return { text: loud.tone === "bad" ? "Fix" : "Check", tone: loud.tone };
  if (p.state === "review" || waiting.has(p.id)) return { text: "Review" };
  if (p.state === "scheduled" || p.state === "published" || p.state === "approved") return null;
  if (p.state === "revise") return { text: "With maker" };
  return { text: STATE_LABEL[p.state] };
}

export default async function CalendarPage({ searchParams }: { searchParams: Search }) {
  const { brand, past, days: daysParam } = await searchParams;
  await requireApprover("/calendar");
  const db = getDb();
  const brands = listBrands(db);
  const activeBrand = brands.some((b) => b.slug === brand) ? brand : undefined;
  const tz = brands[0]?.timezone ?? "Asia/Manila";
  const today = todayIn(tz);
  const showPast = past === "1";
  const span = daysParam === "30" ? 30 : 14;
  const from = showPast ? addDays(today, -7) : today;
  const days = getCalendar(db, { from, days: span + (showPast ? 7 : 0), brand: activeBrand });
  const imports = lastImports(db);
  const waiting = new Set(getReviewStack(db).map((c) => c.id));

  const href = (q: { brand?: string; past?: boolean; days?: number }) => {
    const p = new URLSearchParams();
    if (q.brand) p.set("brand", q.brand);
    if (q.past) p.set("past", "1");
    if (q.days === 30) p.set("days", "30");
    const s = p.toString();
    return s ? `/calendar?${s}` : "/calendar";
  };

  if (!brands.length || !imports.length) {
    return (
      <div className="page">
        <section className="empty">
          <h1>Nothing imported yet</h1>
          <p>
            Run <code>npm run import</code> on the Mac mini to read the Andar and Nest queues. It only reads them; the
            current pipeline keeps running.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <p className="date">Next {span} days</p>
        <h1>Calendar</h1>
      </header>

      <nav className="seg" aria-label="Page">
        <Link href={href({ past: showPast, days: span })} aria-current={!activeBrand}>
          All pages
        </Link>
        {brands.map((b) => (
          <Link key={b.slug} href={href({ brand: b.slug, past: showPast, days: span })} aria-current={activeBrand === b.slug}>
            {b.name}
          </Link>
        ))}
      </nav>

      {days.map((day) => {
        const posts = day.brands
          .flatMap(({ brand: b, slots }) => slots.flatMap((s) => s.posts.map((p) => ({ p, b }))))
          .sort((x, y) => x.p.localTime.localeCompare(y.p.localTime));
        const open = day.brands
          .map(({ brand: b, slots }) => {
            const times = slots.filter((s) => s.empty && s.usual).map((s) => s.time);
            return times.length ? `${activeBrand ? "" : `${b.name} `}${times.join(", ")}` : null;
          })
          .filter(Boolean);
        const isToday = day.date === today;
        return (
          <section key={day.date} className={`day${isToday ? " today" : ""}${day.date < today ? " past" : ""}`}>
            <h3>{isToday ? `Today, ${shortDay(day.date)}` : shortDay(day.date)}</h3>
            {posts.map(({ p, b }) => {
              const st = status(p, waiting);
              const dim = waiting.has(p.id) || p.state === "review" || p.state === "revise" || p.state === "held";
              return (
                <Link
                  key={p.id}
                  href={`/posts/${p.id}`}
                  className={`cr num${dim ? " dim" : ""}${p.state === "rejected" ? " gone" : ""}`}
                  style={{ "--brand": b.colour } as React.CSSProperties}
                >
                  <span className="tm">{p.localTime}</span>
                  <span className="tt">
                    <span className="bd" aria-hidden />
                    <span>{p.title}</span>
                  </span>
                  <span className={`st${st?.tone ? ` ${st.tone}` : ""}`}>{st?.text ?? ""}</span>
                </Link>
              );
            })}
            {open.length > 0 && day.date >= today && <p className="openslots num">Open: {open.join("; ")}</p>}
          </section>
        );
      })}

      <footer className="foot">
        <p>
          {span === 14 ? <Link href={href({ brand: activeBrand, past: showPast, days: 30 })}>Show 30 days</Link> : null}
          {span === 14 ? " · " : null}
          <Link href={href({ brand: activeBrand, past: !showPast, days: span })}>
            {showPast ? "Hide last week" : "Show last week"}
          </Link>
        </p>
        {imports.map((r) => (
          <p key={r.slug}>
            {r.name} imported {formatWhen(r.started_at)}
            {r.skipped > 0 && <>, {r.skipped} rows skipped</>}
          </p>
        ))}
      </footer>
    </div>
  );
}
