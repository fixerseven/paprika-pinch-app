import Link from "next/link";
import { getDb } from "@/lib/db";
import { getCalendar, listBrands } from "@/lib/queries";
import { getReviewStack, listRevisions } from "@/lib/review";
import { requireApprover } from "@/lib/session";
import { STATE_LABEL, loudFlags, shortDay } from "@/lib/labels";
import { todayIn } from "@/lib/time";
import Icon from "./ui/Icon";
import Wordmark from "./ui/Wordmark";

export const dynamic = "force-dynamic";

const SHOW = 4;

export default async function Inbox({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  await requireApprover("/");
  const db = getDb();
  const brands = listBrands(db);
  const colour = new Map(brands.map((b) => [b.slug, b.colour]));
  const tz = brands[0]?.timezone ?? "Asia/Manila";
  const today = todayIn(tz);

  const cards = getReviewStack(db);
  const held = (db.prepare("SELECT COUNT(*) AS n FROM posts WHERE state = 'held'").get() as { n: number }).n;
  const withMakers = listRevisions(db).length;
  const todays = getCalendar(db, { from: today, days: 1 })
    .flatMap((d) => d.brands.flatMap((b) => b.slots.flatMap((s) => s.posts)))
    .filter((p) => p.state !== "rejected")
    .sort((a, b) => a.localTime.localeCompare(b.localTime));
  const shown = all === "1" ? cards : cards.slice(0, SHOW);
  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(),
  );

  return (
    <div className="page">
      <div className="brand">
        <Wordmark />
        <p className="date">{dateLabel}</p>
      </div>
      <header className="page-head">
        <h1>{cards.length ? `${cards.length} to review` : "All clear"}</h1>
      </header>

      {cards.length > 0 && (
        <>
          <h2 className="sect">To review</h2>
          <ul className="rows">
            {shown.map((c) => {
              const loud = loudFlags(c.flags)[0];
              const thumb = c.media.find((m) => m.kind === "image");
              return (
                <li key={c.id}>
                  <Link href={`/review?from=${c.id}`} className="row" style={{ "--brand": c.brandColour } as React.CSSProperties}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="th" src={`/api/media/${thumb.id}`} alt="" loading="lazy" />
                    ) : (
                      <span className="th" aria-hidden />
                    )}
                    <span className="mid">
                      <span className="t">{c.title}</span>
                      <span className="s num">
                        <span className="bd" aria-hidden />
                        {c.brandName} · {c.localDate === today ? "Today" : shortDay(c.localDate)}, {c.localTime}
                      </span>
                    </span>
                    {loud && <span className={`rt ${loud.tone}`}>{loud.tone === "bad" ? "Fix" : "Check"}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          {cards.length > SHOW && all !== "1" && (
            <Link href="/?all=1" className="morel">
              Show {cards.length - SHOW} more
            </Link>
          )}
        </>
      )}

      {todays.length > 0 && <h2 className="sect">Going out today</h2>}
      {todays.length ? (
        <ul className="rows">
          {todays.map((p) => {
            const loud = loudFlags(p.flags)[0];
            return (
              <li key={p.id}>
                <Link href={`/posts/${p.id}`} className="row" style={{ "--brand": colour.get(p.brandSlug) } as React.CSSProperties}>
                  {p.thumbMediaId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="th" src={`/api/media/${p.thumbMediaId}`} alt="" loading="lazy" />
                  ) : (
                    <span className="th" aria-hidden />
                  )}
                  <span className="mid">
                    <span className="t">{p.title}</span>
                    <span className="s num">
                      <span className="bd" aria-hidden />
                      {brands.find((b) => b.slug === p.brandSlug)?.name} · {p.localTime}
                    </span>
                  </span>
                  {loud ? (
                    <span className={`rt ${loud.tone}`}>{loud.tone === "bad" ? "Fix" : "Check"}</span>
                  ) : p.state !== "scheduled" && p.state !== "published" ? (
                    <span className="rt">{p.missed ? "Missed" : STATE_LABEL[p.state]}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div style={{ marginTop: 20 }}>
        {withMakers > 0 && (
          <Link href="/revisions" className="quiet">
            <span>
              {withMakers} {withMakers === 1 ? "post is" : "posts are"} with makers
            </span>
            <Icon name="right" />
          </Link>
        )}
        {held > 0 && (
          <Link href="/review?held=1" className="quiet">
            <span>{held} on hold</span>
            <Icon name="right" />
          </Link>
        )}
      </div>

      {cards.length > 0 && (
        <div className="cta">
          <Link href="/review" className="pri">
            Review {cards.length} {cards.length === 1 ? "post" : "posts"}
          </Link>
        </div>
      )}
      {cards.length > 0 && <div style={{ height: 76 }} />}
    </div>
  );
}
