import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireApprover } from "@/lib/session";
import { getCalendar, lastImports, listBrands, type CalendarPost } from "@/lib/queries";
import { STATE_LABEL, formatWhen, loudFlags, shortDay } from "@/lib/labels";
import { addDays, todayIn } from "@/lib/time";
import { getReviewStack } from "@/lib/review";
import { FOLD_OVER, MANY_PAGES, foldDay, relDay, type FoldKey } from "@/lib/pages";
import PageTile from "../ui/PageTile";
import PagePicker from "./PagePicker";

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

const FOLD_LABEL: Record<FoldKey, string> = { fix: "need a look", review: "to review", with: "waiting on a maker or on hold", scheduled: "scheduled" };

function foldKey(st: { text: string; tone?: "due" | "bad" } | null): FoldKey {
  if (!st) return "scheduled";
  if (st.tone) return "fix";
  if (st.text === "Review") return "review";
  return "with";
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
  const many = brands.length >= MANY_PAGES;
  // The week strip and the page counts always look at the next 7 days across every page.
  const week = getCalendar(db, { from: today, days: 7 });
  const weekPosts = week.map((d) => ({
    date: d.date,
    posts: d.brands.flatMap(({ slots }) => slots.flatMap((s) => s.posts)).filter((p) => p.state !== "rejected"),
  }));
  const weekCount = new Map<string, number>();
  for (const d of weekPosts) for (const p of d.posts) weekCount.set(p.brandSlug, (weekCount.get(p.brandSlug) ?? 0) + 1);

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

      <nav className="week" aria-label="This week">
        {weekPosts.map((d, i) => {
          const mine = d.posts.filter((p) => !activeBrand || p.brandSlug === activeBrand);
          const f = new Date(`${d.date}T00:00:00Z`);
          const needs = mine.some((p) => status(p, waiting)?.tone);
          return (
            <a key={d.date} href={`#d-${d.date}`} className={`wd${i === 0 ? " on" : ""}`} aria-label={`${shortDay(d.date)}, ${mine.length} posts`}>
              <small>{f.toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" })}</small>
              <b className="num">{f.getUTCDate()}</b>
              {many ? (
                <span className={`n num${needs ? " due" : ""}`}>{mine.length || ""}</span>
              ) : (
                <span className="pips">
                  {mine.slice(0, 4).map((p) => {
                    const st = status(p, waiting);
                    return <i key={p.id} className={st?.tone ? "due" : st ? "rev" : undefined} />;
                  })}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      {many ? (
        <PagePicker
          current={activeBrand}
          allHref={href({ past: showPast, days: span })}
          items={brands.map((b) => ({
            slug: b.slug,
            name: b.name,
            colour: b.colour,
            count: weekCount.get(b.slug) ?? 0,
            href: href({ brand: b.slug, past: showPast, days: span }),
          }))}
        />
      ) : (
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
      )}

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
        const label = relDay(day.date, today);
        const row = ({ p, b }: (typeof posts)[number]) => {
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
                {many ? <PageTile name={b.name} colour={b.colour} /> : <span className="bd" aria-hidden />}
                <span>{p.title}</span>
              </span>
              <span className={`st${st?.tone ? ` ${st.tone}` : ""}`}>{st?.text ?? ""}</span>
            </Link>
          );
        };
        const fold = !activeBrand && posts.length > FOLD_OVER;
        const live = posts.filter(({ p }) => p.state !== "rejected").length;
        return (
          <section key={day.date} id={`d-${day.date}`} className={`day${isToday ? " today" : ""}${day.date < today ? " past" : ""}`}>
            <h3>
              {label}
              {label !== shortDay(day.date) && <span className="muted"> {shortDay(day.date)}</span>}
              {live > 0 && <span className="cnt2 num">{live} {live === 1 ? "post" : "posts"}</span>}
            </h3>
            {fold
              ? foldDay(posts, (x) => foldKey(status(x.p, waiting))).map((g) => (
                  <details key={g.key} className={`fold${g.key === "fix" ? " fix" : ""}`}>
                    <summary className="num">
                      <span>
                        {g.items.length} {FOLD_LABEL[g.key]}
                        {g.key === "scheduled" && `, ${g.items[0].p.localTime} to ${g.items[g.items.length - 1].p.localTime}`}
                      </span>
                      <svg className="i" viewBox="0 0 24 24" aria-hidden>
                        <path d="M10 6l6 6-6 6" />
                      </svg>
                    </summary>
                    {g.items.map(row)}
                  </details>
                ))
              : posts.map(row)}
            {open.length > 0 && day.date >= today && (
              <p className="openslots num">
                {many && !activeBrand && open.length > 2
                  ? `Open slots on ${open.length} pages`
                  : `Open: ${open.join("; ")}`}
              </p>
            )}
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
