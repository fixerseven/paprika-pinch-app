import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db";
import type { BrandConfig } from "./brands";
import { safeRelPath, type Flag, type Part } from "./import/queue";
import { localToUtc } from "./time";
import { targetsFor } from "./targets";

const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const MEDIA = /\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm)$/i;
const PARTS: Part[] = ["feed", "story", "reel"];

export class MakerError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface MakerPostInput {
  brand: string;
  externalId: string;
  date: string;
  time: string;
  title: string;
  caption?: string | null;
  media?: { part: Part; path: string }[];
  owner?: string | null;
  notes?: string | null;
  track?: string | null;
  /** Free-text heads-ups for the reviewer, shown on the card. */
  checks?: string[];
  /** What changed, for a revision. */
  note?: string | null;
}

export interface MakerResult {
  id: number;
  externalId: string;
  brand: string;
  state: "review";
  version: number;
  created: boolean;
}

function str(v: unknown, name: string, max = 2000): string {
  if (typeof v !== "string" || !v.trim()) throw new MakerError(`${name} is required`);
  if (v.length > max) throw new MakerError(`${name} is too long`);
  return v.trim();
}

/**
 * A maker (a person or an agent) sends a new post, or a new version of one, for review.
 *
 * Every post sent here lands in "To review" and needs a person's yes before
 * it can go anywhere. Files must sit inside the brand's own folder, and the
 * post id must match the brand's pattern, so an Andar post can't be filed
 * under Nest or point at Nest files.
 */
export function submitPost(
  db: DB,
  brands: BrandConfig[],
  raw: unknown,
  opts: { maker: string; root?: (brand: BrandConfig) => string | undefined; now?: Date },
): MakerResult {
  if (!raw || typeof raw !== "object") throw new MakerError("Send a JSON object");
  const body = raw as Record<string, unknown>;
  const brand = brands.find((b) => b.slug === body.brand);
  if (!brand) throw new MakerError(`brand must be one of: ${brands.map((b) => b.slug).join(", ")}`);

  const externalId = str(body.externalId, "externalId", 40);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(externalId)) throw new MakerError("externalId may only use letters, digits, - and _");
  if (!new RegExp(brand.postIdPattern).test(externalId))
    throw new MakerError(`${externalId} doesn't look like a ${brand.name} post id`);
  const date = str(body.date, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new MakerError("date must be YYYY-MM-DD");
  const time = str(body.time, "time", 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new MakerError("time must be HH:MM (24-hour, Manila)");
  const title = str(body.title, "title", 200);
  const caption = typeof body.caption === "string" ? body.caption : null;
  if (caption && caption.length > 5000) throw new MakerError("caption is too long");
  const opt = (k: string, max = 2000) => {
    const v = body[k];
    if (v == null || v === "") return null;
    if (typeof v !== "string" || v.length > max) throw new MakerError(`${k} must be text`);
    return v;
  };

  const rawMedia = body.media ?? [];
  if (!Array.isArray(rawMedia) || rawMedia.length > 20) throw new MakerError("media must be a list of up to 20 files");
  const root = opts.root?.(brand);
  const rootAbs = root ? path.resolve(root) : undefined;
  const positions: Record<string, number> = {};
  const media = rawMedia.map((m, i) => {
    const part = (m as any)?.part as Part;
    const p = (m as any)?.path as string;
    if (!PARTS.includes(part)) throw new MakerError(`media[${i}].part must be feed, story or reel`);
    if (typeof p !== "string" || !safeRelPath(p)) throw new MakerError(`media[${i}].path must be relative to the ${brand.name} folder`);
    if (!MEDIA.test(p)) throw new MakerError(`media[${i}].path isn't an image or video`);
    if (rootAbs) {
      const abs = path.resolve(rootAbs, p);
      if (!abs.startsWith(rootAbs + path.sep)) throw new MakerError(`media[${i}].path is outside the ${brand.name} folder`);
      if (!fs.existsSync(abs)) throw new MakerError(`media[${i}].path not found in the ${brand.name} folder: ${p}`);
    }
    positions[part] = (positions[part] ?? 0) + 1;
    return { part, position: positions[part], path: p, kind: VIDEO.test(p) ? ("video" as const) : ("image" as const) };
  });
  const parts = PARTS.filter((p) => media.some((m) => m.part === p));

  const checks = body.checks ?? [];
  if (!Array.isArray(checks) || checks.some((c) => typeof c !== "string")) throw new MakerError("checks must be a list of text");
  const flags: Flag[] = (checks as string[]).slice(0, 10).map((text) => ({ code: "check_fact", text: text.slice(0, 300) }) as Flag);
  if (!caption?.trim()) flags.push({ code: "caption_missing", text: "No caption yet" } as Flag);
  if (!media.length) flags.push({ code: "missing_media", text: "No images or video yet" } as Flag);
  if (parts.includes("story")) flags.push({ code: "fb_story_manual", text: "Facebook story must be posted by hand" } as Flag);
  if (!brand.slots.includes(time)) flags.push({ code: "off_slot", text: `${time} isn't one of the usual slots` } as Flag);

  const now = (opts.now ?? new Date()).toISOString();
  const brandRow = db.prepare("SELECT id FROM brands WHERE slug = ?").get(brand.slug) as { id: number } | undefined;
  if (!brandRow) throw new MakerError("brand isn't set up yet", 503);
  const hash = crypto.createHash("sha256").update(JSON.stringify({ caption, media })).digest("hex");
  const fields = {
    brandId: brandRow.id,
    externalId,
    localDate: date,
    localTime: time,
    scheduledAt: localToUtc(date, time, brand.timezone),
    title,
    track: opt("track", 100),
    owner: opt("owner", 100) ?? opts.maker,
    flags: JSON.stringify(flags),
    notes: opt("notes"),
    now,
  };
  const note = opt("note", 500);

  return db.transaction((): MakerResult => {
    const existing = db.prepare("SELECT id, state FROM posts WHERE brand_id = ? AND external_id = ?").get(brandRow.id, externalId) as
      | { id: number; state: string }
      | undefined;
    if (existing && ["scheduled", "published"].includes(existing.state)) {
      throw new MakerError(`${externalId} is already ${existing.state}; it can't be changed from here`, 409);
    }

    let postId: number;
    let number = 1;
    if (existing) {
      postId = existing.id;
      const latest = db.prepare("SELECT number FROM versions WHERE post_id = ? ORDER BY number DESC LIMIT 1").get(postId) as
        | { number: number }
        | undefined;
      number = (latest?.number ?? 0) + 1;
      db.prepare(
        `UPDATE posts SET local_date = @localDate, local_time = @localTime, scheduled_at = @scheduledAt, title = @title,
           track = @track, owner = @owner, flags = @flags, notes = @notes, state = 'review',
           state_reason = 'New version from ' || @maker, source = 'api', updated_at = @now
         WHERE id = @id`,
      ).run({ ...fields, maker: opts.maker, id: postId });
    } else {
      postId = (
        db
          .prepare(
            `INSERT INTO posts (brand_id, external_id, local_date, local_time, scheduled_at, title, track, owner,
               state, state_reason, flags, notes, source, source_ref, created_at, updated_at)
             VALUES (@brandId, @externalId, @localDate, @localTime, @scheduledAt, @title, @track, @owner,
               'review', 'New from ' || @maker, @flags, @notes, 'api', 'maker-api', @now, @now)
             RETURNING id`,
          )
          .get({ ...fields, maker: opts.maker }) as { id: number }
      ).id;
    }

    const { id: versionId } = db
      .prepare(
        `INSERT INTO versions (post_id, number, caption, caption_ref, content_hash, created_by, note)
         VALUES (?, ?, ?, NULL, ?, ?, ?) RETURNING id`,
      )
      .get(postId, number, caption, hash, opts.maker, note ?? (existing ? "Revised" : "New post")) as { id: number };
    const insertMedia = db.prepare("INSERT INTO media (version_id, part, position, path, kind) VALUES (?, ?, ?, ?, ?)");
    for (const m of media) insertMedia.run(versionId, m.part, m.position, m.path, m.kind);
    db.prepare("UPDATE posts SET current_version_id = ? WHERE id = ?").run(versionId, postId);

    db.prepare("DELETE FROM post_channels WHERE post_id = ?").run(postId);
    const insertTarget = db.prepare("INSERT OR IGNORE INTO post_channels (post_id, channel_id, part) VALUES (?, ?, ?)");
    for (const t of targetsFor(db, brandRow.id, parts)) insertTarget.run(postId, t.channelId, t.part);

    return { id: postId, externalId, brand: brand.slug, state: "review", version: number, created: !existing };
  })();
}
