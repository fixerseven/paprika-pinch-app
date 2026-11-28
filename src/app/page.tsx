import Link from "next/link";
import { getDb } from "@/lib/db";
import { channelIssues, getCalendar, listBrands } from "@/lib/queries";
import { getReviewStack, listRevisions } from "@/lib/review";
import { requireApprover } from "@/lib/session";
import { STATE_LABEL, loudFlags } from "@/lib/labels";
import { MANY_PAGES, groupByPage, relDay } from "@/lib/pages";
import { todayIn } from "@/lib/time";
import Icon from "./ui/Icon";
import PageTile from "./ui/PageTile";
import Wordmark from "./ui/Wordmark";
import ChannelIssues from "./ui/ChannelIssues";

export const dynamic = "force-dynamic";

const SHOW_POSTS = 4;
const SHOW_PAGES = 5;

export default async function Inbox({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const showAll = all === "1";
  await requireApprover("/");
  const db = getDb();
  const brands = listBrands(db);
  const brand = new Map(brands.map((b) => [b.slug, b]));
  const many = brands.length >= MANY_PAGES;
  const tz = brands[0]?.timezone ?? "Asia/Manila";
  const today = todayIn(tz);

  const cards = getReviewStack(db);
  const held = (db.prepare("SELECT COUNT(*) AS n FROM posts WHERE state = 'held'").get() as { n: number }).n;
  const withMakers = listRevisions(db).length;
  const issues = channelIssues(db);
  const todays = getCalendar(db, { from: today, days: 1 })
    .flatMap((d) => d.brands.flatMap((b) => b.slots.flatMap((s) => s.posts)))
    .filter((p) => p.state !== "rejected")
    .sort((a, b) => a.localTime.localeCompare(b.localTime));
  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(),
  );

  const reviewGroups = groupByPage(cards);
  const todayGroups = groupByPage(todays);
  const more = (n: number, what: string) =>
    !showAll && n > 0 ? (
      <Link href="/?all=1" className="morel">
        Show {n} more{what ? ` ${what}` : ""}
      </Link>
    ) : null;

  return (
    <div className="page">
      <div className="brand">
        <Wordmark />
        <p className="date">{dateLabel}</p>
      </div>
      <header className="page-head">
        <h1>{cards.length ? `${cards.length} to review` : "All clear"}</h1>
      </header>

      <ChannelIssues issues={issues} />

      {cards.length > 0 && (
        <>
          <h2 className="sect h2c">
            To review
            {many && (
              <span className="num">
                {cards.length} posts, {reviewGroups.length} pages
              </span>
            )}
          </h2>
          {many ? (
            <>
              <ul className="rows">
                {(showAll ? reviewGroups : reviewGroups.slice(0, SHOW_PAGES)).map((g) => {
                  const b = brand.get(g.slug)!;
                  const n = g.items.length;
                  return (
                    <li key={g.slug}>
                      <Link href={`/review?brand=${g.slug}`} className="prow">
                        <PageTile name={b.name} colour={b.colour} large />
                        <span className="mid">
                          <span className="t">{b.name}</span>
                          <span className="s num">
                            {n} {n === 1 ? "post" : "posts"} · from {relDay(g.items[0].localDate, today)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {more(reviewGroups.length - SHOW_PAGES, "pages")}
            </>
          ) : (
            <>
              <ul className="rows">
                {(showAll ? cards : cards.slice(0, SHOW_POSTS)).map((c) => {
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
                            {c.brandName} · {relDay(c.localDate, today)} {c.localTime}
                          </span>
                        </span>
                        {loud && <span className={`rt ${loud.tone}`}>{loud.tone === "bad" ? "Fix" : "Check"}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {more(cards.length - SHOW_POSTS, "")}
            </>
          )}
        </>
      )}

      {todays.length > 0 && (
        <h2 className="sect h2c">
          Going out today
          {many && <span className="num">{todayGroups.length} pages</span>}
        </h2>
      )}
      {todays.length > 0 && many ? (
        <ul className="rows">
          {(showAll ? todayGroups : todayGroups.slice(0, SHOW_PAGES)).map((g) => {
            const b = brand.get(g.slug)!;
            const flagged = g.items.find((p) => loudFlags(p.flags).length || p.missed || p.state === "failed");
            return (
              <li key={g.slug}>
                <Link href={`/calendar?brand=${g.slug}`} className="prow">
                  <PageTile name={b.name} colour={b.colour} large />
                  <span className="mid">
                    <span className="t">{b.name}</span>
                    <span className="s num">
                      {g.items.length} {g.items.length === 1 ? "post" : "posts"} · {g.items.map((p) => p.localTime).join(", ")}
                    </span>
                  </span>
                  {flagged && <span className="rt bad">{flagged.missed ? "Missed" : flagged.state === "failed" ? "Failed" : "Check"}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : todays.length > 0 ? (
        <ul className="rows">
          {todays.map((p) => {
            const loud = loudFlags(p.flags)[0];
            return (
              <li key={p.id}>
                <Link href={`/posts/${p.id}`} className="trow" style={{ "--brand": brand.get(p.brandSlug)?.colour } as React.CSSProperties}>
                  <span className="tm num">{p.localTime}</span>
                  <span className="mid">
                    <span className="t">{p.title}</span>
                    <span className="s">
                      <span className="bd" aria-hidden />
                      {brand.get(p.brandSlug)?.name}
                    </span>
                  </span>
                  {loud ? (
                    <span className={`rt ${loud.tone}`}>{loud.tone === "bad" ? "Fix" : "Check"}</span>
                  ) : p.state !== "scheduled" && p.state !== "published" && p.state !== "approved" ? (
                    <span className={`rt${p.missed || p.state === "failed" ? " bad" : ""}`}>{p.missed ? "Missed" : STATE_LABEL[p.state]}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {todays.length > 0 && many && more(todayGroups.length - SHOW_PAGES, "pages")}

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
