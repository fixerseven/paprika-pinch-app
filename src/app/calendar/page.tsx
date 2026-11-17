import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireApprover } from "@/lib/session";
import { getCalendar, lastImports, listBrands, type CalendarPost } from "@/lib/queries";
import { PLATFORM_SHORT, STATE_LABEL, STATE_ORDER, formatDay, formatWhen } from "@/lib/labels";
import { addDays, todayIn } from "@/lib/time";

export const dynamic = "force-dynamic";

const DAYS = 30;

type Search = Promise<{ brand?: string; past?: string }>;

export default async function CalendarPage({ searchParams }: { searchParams: Search }) {
  const { brand, past } = await searchParams;
  await requireApprover("/calendar");
  const db = getDb();
  const brands = listBrands(db);
  const activeBrand = brands.some((b) => b.slug === brand) ? brand : undefined;
  const tz = brands[0]?.timezone ?? "Asia/Manila";
  const today = todayIn(tz);
  const showPast = past === "1";
  const from = showPast ? addDays(today, -7) : today;
  const days = getCalendar(db, { from, days: DAYS + (showPast ? 7 : 0), brand: activeBrand });
  const imports = lastImports(db);

  const all = days.flatMap((d) => d.brands.flatMap((b) => b.slots.flatMap((s) => s.posts)));
  const upcoming = days.filter((d) => d.date >= today);
  const emptySlots = upcoming.reduce(
    (n, d) => n + d.brands.reduce((m, b) => m + b.slots.filter((s) => s.empty && s.usual).length, 0),
    0,
  );
  const counts = STATE_ORDER.map((s) => ({ state: s, n: all.filter((p) => p.state === s).length })).filter(
    (c) => c.n > 0,
  );

  const href = (q: { brand?: string; past?: boolean }) => {
    const p = new URLSearchParams();
    if (q.brand) p.set("brand", q.brand);
    if (q.past) p.set("past", "1");
    const s = p.toString();
    return s ? `/calendar?${s}` : "/calendar";
  };

  if (!brands.length || !imports.length) {
    return (
      <section className="empty-state">
        <h1>Nothing imported yet</h1>
        <p>
          Run <code>npm run import</code> on the Mac mini to read the Andar and Nest queues. It only reads them; the
          current pipeline keeps running.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="cal-head">
        <h1>Calendar</h1>
        <p className="sub">
          {formatDay(from).day} {formatDay(from).month} to {formatDay(days[days.length - 1].date).day}{" "}
          {formatDay(days[days.length - 1].date).month} · {all.length} posts ·{" "}
          <strong>{emptySlots}</strong> empty {emptySlots === 1 ? "slot" : "slots"} ahead
        </p>

        <div className="filters" role="group" aria-label="Brand">
          <Link href={href({ past: showPast })} className={`chip ${!activeBrand ? "chip-on" : ""}`}>
            All
          </Link>
          {brands.map((b) => (
            <Link
              key={b.slug}
              href={href({ brand: b.slug, past: showPast })}
              className={`chip ${activeBrand === b.slug ? "chip-on" : ""}`}
              style={{ "--brand": b.colour } as React.CSSProperties}
            >
              <span className="brand-dot" aria-hidden />
              {b.name}
            </Link>
          ))}
          <Link href={href({ brand: activeBrand, past: !showPast })} className={`chip ${showPast ? "chip-on" : ""}`}>
            {showPast ? "Hide last week" : "Show last week"}
          </Link>
        </div>

        <ul className="legend" aria-label="States">
          {counts.map((c) => (
            <li key={c.state}>
              <span className={`dot st-${c.state}`} aria-hidden /> {STATE_LABEL[c.state]} {c.n}
            </li>
          ))}
          <li>
            <span className="dot st-empty" aria-hidden /> Empty slot
          </li>
        </ul>
      </section>

      <ol className="days">
        {days.map((day) => {
          const f = formatDay(day.date);
          const isToday = day.date === today;
          return (
            <li key={day.date} className={`day ${isToday ? "day-today" : ""} ${day.date < today ? "day-past" : ""}`}>
              <div className="day-label">
                <span className="wd">{isToday ? "Today" : f.weekday}</span>
                <span className="dn">{f.day}</span>
                <span className="mo">{f.month}</span>
              </div>
              <div className="day-body">
                {day.brands.map(({ brand: b, slots }) => (
                  <div
                    key={b.slug}
                    className="brand-row"
                    style={{ "--brand": b.colour } as React.CSSProperties}
                  >
                    {!activeBrand && <div className="brand-name">{b.name}</div>}
                    <ul className="slots">
                      {slots.map((s) => (
                        <li key={s.time} className="slot">
                          <span className="slot-time">{s.time}</span>
                          <div className="slot-posts">
                            {s.posts.map((p) => (
                              <PostChip key={p.id} p={p} />
                            ))}
                            {s.empty && (
                              <span className="empty-slot">{s.posts.length ? "Slot open again" : "Empty slot"}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="imports">
        {imports.map((r) => (
          <p key={r.slug}>
            {r.name}: imported {formatWhen(r.started_at)}
            {r.queue_modified_at && <> from the queue saved {formatWhen(r.queue_modified_at)}</>}
            {r.skipped > 0 && <> · {r.skipped} rows skipped</>}
          </p>
        ))}
        <p>Read-only. Nothing here posts or changes the old queues.</p>
      </footer>
    </>
  );
}

const FLAG_ICON: Record<string, string> = {
  check_fact: "Check fact",
  silent_reel: "No sound",
  conflict: "Mismatch",
  legacy_needs_yes: "Needs old yes",
  caption_unfinished: "Caption unfinished",
  caption_missing: "No caption",
  missing_media: "File missing",
  bad_media_path: "Bad path",
  partly_scheduled: "Partly scheduled",
};

function PostChip({ p }: { p: CalendarPost }) {
  const flags = p.flags.filter((f) => FLAG_ICON[f.code]);
  return (
    <Link href={`/posts/${p.id}`} className={`post st-${p.state} ${p.missed ? "post-missed" : ""}`}>
      {p.thumbMediaId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={`/api/media/${p.thumbMediaId}`} alt="" loading="lazy" />
      ) : (
        <span className="thumb thumb-none" aria-hidden />
      )}
      <span className="post-main">
        <span className="post-top">
          <span className="post-id">{p.externalId}</span>
          <span className={`pill st-${p.state}`}>{p.missed ? "Missed" : STATE_LABEL[p.state]}</span>
        </span>
        <span className="post-title">{p.title}</span>
        <span className="post-meta">
          {p.parts.join(" + ")}
          {p.channels.length > 0 && <> · {p.channels.map((c) => PLATFORM_SHORT[c.platform] ?? c.platform).join(", ")}</>}
        </span>
        {flags.length > 0 && (
          <span className="flags">
            {flags.map((f) => (
              <span key={f.code} className={`flag flag-${f.code}`} title={f.text}>
                {FLAG_ICON[f.code]}
              </span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}
