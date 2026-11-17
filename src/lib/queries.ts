import type { DB } from "./db";
import type { Flag, Part, PostState } from "./import/queue";
import { addDays } from "./time";

export interface BrandRow {
  id: number;
  slug: string;
  name: string;
  colour: string;
  timezone: string;
  slots: string[];
}

export interface CalendarPost {
  id: number;
  brandSlug: string;
  externalId: string;
  localDate: string;
  localTime: string;
  scheduledAt: string;
  title: string;
  state: PostState;
  stateReason: string | null;
  flags: Flag[];
  parts: Part[];
  channels: { key: string; platform: string }[];
  thumbMediaId: number | null;
  /** Its slot has passed and it never went out (approved, held, review or revise). */
  missed: boolean;
}

export interface CalendarSlot {
  time: string;
  posts: CalendarPost[];
  /** No live post fills this slot (none at all, or only rejected ones). */
  empty: boolean;
  usual: boolean;
}

export interface CalendarDay {
  date: string;
  brands: { brand: BrandRow; slots: CalendarSlot[] }[];
}

export function listBrands(db: DB): BrandRow[] {
  return (db.prepare("SELECT id, slug, name, colour, timezone, slots FROM brands ORDER BY id").all() as any[]).map(
    (b) => ({ ...b, slots: JSON.parse(b.slots) }),
  );
}

const OPEN_STATES: PostState[] = ["review", "approved", "held", "revise"];

export function getCalendar(
  db: DB,
  opts: { from: string; days: number; brand?: string; now?: Date },
): CalendarDay[] {
  const now = (opts.now ?? new Date()).toISOString();
  const to = addDays(opts.from, opts.days - 1);
  const brands = listBrands(db).filter((b) => !opts.brand || b.slug === opts.brand);
  const ids = brands.map((b) => b.id);
  if (!ids.length) return [];

  const rows = db
    .prepare(
      `SELECT p.id, p.brand_id, p.external_id, p.local_date, p.local_time, p.scheduled_at, p.title, p.state,
              p.state_reason, p.flags, p.current_version_id
       FROM posts p
       WHERE p.brand_id IN (${ids.map(() => "?").join(",")}) AND p.local_date BETWEEN ? AND ?
       ORDER BY p.local_date, p.local_time, p.external_id`,
    )
    .all(...ids, opts.from, to) as any[];

  const targets = db.prepare(
    `SELECT DISTINCT c.key, c.platform, pc.part FROM post_channels pc JOIN channels c ON c.id = pc.channel_id
     WHERE pc.post_id = ? ORDER BY c.platform`,
  );
  const thumb = db.prepare(
    `SELECT id FROM media WHERE version_id = ? AND kind = 'image'
     ORDER BY CASE part WHEN 'feed' THEN 0 WHEN 'story' THEN 1 ELSE 2 END, position LIMIT 1`,
  );
  const partsOf = db.prepare("SELECT DISTINCT part FROM media WHERE version_id = ?");

  const bySlug = new Map(brands.map((b) => [b.id, b]));
  const posts: (CalendarPost & { brandId: number })[] = rows.map((r) => {
    const t = targets.all(r.id) as { key: string; platform: string; part: Part }[];
    const channels = [...new Map(t.map((x) => [x.key, { key: x.key, platform: x.platform }])).values()];
    const parts = (r.current_version_id ? (partsOf.all(r.current_version_id) as { part: Part }[]) : []).map(
      (x) => x.part,
    );
    const order: Part[] = ["feed", "story", "reel"];
    return {
      id: r.id,
      brandId: r.brand_id,
      brandSlug: bySlug.get(r.brand_id)!.slug,
      externalId: r.external_id,
      localDate: r.local_date,
      localTime: r.local_time,
      scheduledAt: r.scheduled_at,
      title: r.title,
      state: r.state,
      stateReason: r.state_reason,
      flags: JSON.parse(r.flags),
      parts: order.filter((p) => parts.includes(p)),
      channels,
      thumbMediaId: r.current_version_id ? ((thumb.get(r.current_version_id) as { id: number } | undefined)?.id ?? null) : null,
      missed: OPEN_STATES.includes(r.state) && r.scheduled_at < now,
    };
  });

  const days: CalendarDay[] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.from, i);
    days.push({
      date,
      brands: brands.map((brand) => {
        const dayPosts = posts.filter((p) => p.brandId === brand.id && p.localDate === date);
        const times = [...new Set([...brand.slots, ...dayPosts.map((p) => p.localTime)])].sort();
        return {
          brand,
          slots: times.map((time) => {
            const here = dayPosts.filter((p) => p.localTime === time);
            return {
              time,
              posts: here,
              empty: !here.some((p) => p.state !== "rejected"),
              usual: brand.slots.includes(time),
            };
          }),
        };
      }),
    });
  }
  return days;
}

export function lastImports(db: DB) {
  return db
    .prepare(
      `SELECT b.slug, b.name, r.started_at, r.queue_modified_at, r.created, r.updated, r.skipped, r.warnings
       FROM import_runs r JOIN brands b ON b.id = r.brand_id
       WHERE r.id IN (SELECT MAX(id) FROM import_runs GROUP BY brand_id)
       ORDER BY b.id`,
    )
    .all() as {
    slug: string;
    name: string;
    started_at: string;
    queue_modified_at: string | null;
    created: number;
    updated: number;
    skipped: number;
    warnings: string;
  }[];
}

export function getPost(db: DB, id: number) {
  const post = db
    .prepare(
      `SELECT p.*, b.slug AS brand_slug, b.name AS brand_name, b.colour AS brand_colour, b.timezone
       FROM posts p JOIN brands b ON b.id = p.brand_id WHERE p.id = ?`,
    )
    .get(id) as any;
  if (!post) return undefined;
  const version = post.current_version_id
    ? (db.prepare("SELECT * FROM versions WHERE id = ?").get(post.current_version_id) as any)
    : null;
  const media = version
    ? (db
        .prepare(
          `SELECT * FROM media WHERE version_id = ?
           ORDER BY CASE part WHEN 'feed' THEN 0 WHEN 'story' THEN 1 ELSE 2 END, position`,
        )
        .all(version.id) as any[])
    : [];
  const versions = db
    .prepare("SELECT id, number, created_by, note, created_at FROM versions WHERE post_id = ? ORDER BY number DESC")
    .all(id) as any[];
  const channels = db
    .prepare(
      `SELECT c.key, c.platform, c.name, pc.part FROM post_channels pc JOIN channels c ON c.id = pc.channel_id
       WHERE pc.post_id = ? ORDER BY c.platform, pc.part`,
    )
    .all(id) as any[];
  const decisions = db
    .prepare("SELECT * FROM decisions WHERE post_id = ? ORDER BY created_at DESC, id DESC")
    .all(id) as any[];
  const jobs = db
    .prepare("SELECT * FROM publish_jobs WHERE post_id = ? ORDER BY part, id")
    .all(id) as any[];
  return { post: { ...post, flags: JSON.parse(post.flags) as Flag[] }, version, media, versions, channels, decisions, jobs };
}
