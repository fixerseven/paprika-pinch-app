import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "../db";
import type { BrandConfig } from "../brands";
import { localToUtc } from "../time";
import { targetsFor as brandTargets } from "../targets";
import { parseCsvObjects } from "./csv";
import { parseCaptionFile } from "./captions";
import { mapQueue, type ImportedPost, type LegacyStateEntry, type Part } from "./queue";

export interface ImportSummary {
  brand: string;
  created: number;
  updated: number;
  newVersions: number;
  unchanged: number;
  skipped: { row: number; postId: string; reason: string }[];
  warnings: string[];
}

/**
 * Read one brand's old queue and bring it into Pinch.
 *
 * Read-only on the brand's folder: this only ever opens files for reading,
 * and only files inside `root`. It never touches Postiz.
 *
 * Re-running is safe. A post that Pinch has already made a decision on (any
 * decision not made by the importer) keeps its state; if its caption or media
 * changed in the queue, a new version is recorded and it goes back to review.
 */
export function importBrand(
  db: DB,
  brand: BrandConfig,
  root: string,
  opts: { now?: Date; checkFiles?: boolean } = {},
): ImportSummary {
  const now = opts.now ?? new Date();
  const brandRow = db.prepare("SELECT id FROM brands WHERE slug = ?").get(brand.slug) as { id: number } | undefined;
  if (!brandRow) throw new Error(`brand ${brand.slug} isn't in the database; sync brands first`);
  const brandId = brandRow.id;
  const rootAbs = path.resolve(root);

  const inRoot = (rel: string) => {
    const abs = path.resolve(rootAbs, rel);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new Error(`path escapes brand folder: ${rel}`);
    return abs;
  };

  const csvPath = inRoot(brand.queue.csv);
  const csvText = fs.readFileSync(csvPath, "utf8");
  const queueModifiedAt = fs.statSync(csvPath).mtime.toISOString();

  let legacyState: Record<string, LegacyStateEntry> = {};
  const statePath = inRoot(brand.queue.postizState);
  const warnings: string[] = [];
  if (fs.existsSync(statePath)) {
    try {
      legacyState = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch (e) {
      warnings.push(`couldn't read ${brand.queue.postizState}: ${(e as Error).message}`);
    }
  }

  const captionFiles = new Map<string, Map<string, string> | null>();
  const mapped = mapQueue(parseCsvObjects(csvText), {
    postIdPattern: brand.postIdPattern,
    slots: brand.slots,
    legacyState,
    caption: (file, key) => {
      if (!captionFiles.has(file)) {
        try {
          captionFiles.set(file, parseCaptionFile(fs.readFileSync(inRoot(file), "utf8")));
        } catch {
          captionFiles.set(file, null);
        }
      }
      const sections = captionFiles.get(file);
      if (!sections) return undefined;
      return sections.has(key) ? { found: true, text: sections.get(key) } : { found: false };
    },
    fileExists: opts.checkFiles === false ? undefined : (rel) => fs.existsSync(inRoot(rel)),
  });
  warnings.push(...mapped.warnings);

  const summary: ImportSummary = {
    brand: brand.slug,
    created: 0,
    updated: 0,
    newVersions: 0,
    unchanged: 0,
    skipped: mapped.skipped,
    warnings,
  };

  const q = {
    find: db.prepare("SELECT * FROM posts WHERE brand_id = ? AND external_id = ?"),
    humanDecided: db.prepare(
      "SELECT 1 FROM decisions WHERE post_id = ? AND actor <> 'import' AND undone_at IS NULL LIMIT 1",
    ),
    latestVersion: db.prepare(
      "SELECT id, number, content_hash FROM versions WHERE post_id = ? ORDER BY number DESC LIMIT 1",
    ),
    insertPost: db.prepare(`
      INSERT INTO posts (brand_id, external_id, local_date, local_time, scheduled_at, title, track, owner,
        state, state_reason, flags, notes, source, source_ref)
      VALUES (@brandId, @externalId, @localDate, @localTime, @scheduledAt, @title, @track, @owner,
        @state, @stateReason, @flags, @notes, 'import', @sourceRef)
      RETURNING id`),
    updatePost: db.prepare(`
      UPDATE posts SET local_date = @localDate, local_time = @localTime, scheduled_at = @scheduledAt,
        title = @title, track = @track, owner = @owner, state = @state, state_reason = @stateReason,
        flags = @flags, notes = @notes, updated_at = @now
      WHERE id = @id`),
    setVersion: db.prepare("UPDATE posts SET current_version_id = ?, updated_at = ? WHERE id = ?"),
    sendBackToReview: db.prepare(
      "UPDATE posts SET state = 'review', state_reason = ?, updated_at = ? WHERE id = ?",
    ),
    insertVersion: db.prepare(`
      INSERT INTO versions (post_id, number, caption, caption_ref, content_hash, created_by, note)
      VALUES (?, ?, ?, ?, ?, 'import', ?) RETURNING id`),
    insertMedia: db.prepare("INSERT INTO media (version_id, part, position, path, kind) VALUES (?, ?, ?, ?, ?)"),
    clearTargets: db.prepare("DELETE FROM post_channels WHERE post_id = ?"),
    insertTarget: db.prepare("INSERT OR IGNORE INTO post_channels (post_id, channel_id, part) VALUES (?, ?, ?)"),
    insertDecision: db.prepare(
      "INSERT INTO decisions (post_id, version_id, action, comment, actor) VALUES (?, ?, 'import', ?, 'import')",
    ),
    upsertJob: db.prepare(`
      INSERT INTO publish_jobs (post_id, part, postiz_post_id, status, publish_at, source)
      VALUES (@postId, @part, @postizPostId, @status, @publishAt, 'legacy-import')
      ON CONFLICT (postiz_post_id) DO UPDATE SET status = excluded.status, publish_at = excluded.publish_at,
        updated_at = @now
      WHERE publish_jobs.source = 'legacy-import' AND publish_jobs.post_id = excluded.post_id`),
  };

  const targetsFor = (parts: Part[]) => brandTargets(db, brandId, parts);

  const hashOf = (p: ImportedPost) =>
    crypto
      .createHash("sha256")
      .update(JSON.stringify({ caption: p.caption, media: p.media }))
      .digest("hex");

  const nowIso = now.toISOString();

  db.transaction(() => {
    for (const p of mapped.posts) {
      const fields = {
        brandId,
        externalId: p.externalId,
        localDate: p.localDate,
        localTime: p.localTime,
        scheduledAt: localToUtc(p.localDate, p.localTime, brand.timezone),
        title: p.title,
        track: p.track,
        owner: p.owner,
        state: p.state,
        stateReason: p.stateReason,
        flags: JSON.stringify(p.flags),
        notes: p.notes,
        sourceRef: brand.queue.csv,
        now: nowIso,
      };
      const hash = hashOf(p);
      const addVersion = (postId: number, number: number, note: string) => {
        const { id } = q.insertVersion.get(postId, number, p.caption, p.captionRef, hash, note) as { id: number };
        for (const m of p.media) q.insertMedia.run(id, m.part, m.position, m.path, m.kind);
        q.setVersion.run(id, nowIso, postId);
        return id;
      };
      const saveJobs = (postId: number) => {
        for (const j of p.legacyJobs) q.upsertJob.run({ postId, ...j, now: nowIso });
      };

      const existing = q.find.get(brandId, p.externalId) as { id: number; state: string; source: string } | undefined;
      if (existing?.source === "api") {
        // A maker sent this post straight to Pinch; the old queue no longer owns it.
        summary.skipped.push({ row: p.row, postId: p.externalId, reason: "managed in Pinch now (sent through the maker API)" });
        continue;
      }
      if (!existing) {
        const { id } = q.insertPost.get(fields) as { id: number };
        const versionId = addVersion(id, 1, "Imported from the old queue");
        for (const t of targetsFor(p.parts)) q.insertTarget.run(id, t.channelId, t.part);
        q.insertDecision.run(id, versionId, `Imported: queue status "${p.queueStatus}"`);
        saveJobs(id);
        summary.created++;
        continue;
      }

      const decided = !!q.humanDecided.get(existing.id);
      const latest = q.latestVersion.get(existing.id) as { id: number; number: number; content_hash: string };
      let changed = false;
      let versionId = latest.id;
      if (latest.content_hash !== hash) {
        versionId = addVersion(existing.id, latest.number + 1, "Caption or media changed in the old queue");
        summary.newVersions++;
        changed = true;
        if (decided) {
          q.sendBackToReview.run("Changed in the old queue after a decision in Pinch", nowIso, existing.id);
          q.insertDecision.run(existing.id, versionId, "New version from the old queue; needs approval again");
        }
      }
      if (!decided) {
        const before = q.find.get(brandId, p.externalId) as Record<string, unknown>;
        q.updatePost.run({ ...fields, id: existing.id });
        q.clearTargets.run(existing.id);
        for (const t of targetsFor(p.parts)) q.insertTarget.run(existing.id, t.channelId, t.part);
        if (before.state !== p.state) {
          q.insertDecision.run(existing.id, versionId, `Re-imported: queue status "${p.queueStatus}"`);
        }
        const keys = ["local_date", "local_time", "title", "track", "owner", "state", "state_reason", "flags", "notes"];
        const after = q.find.get(brandId, p.externalId) as Record<string, unknown>;
        if (keys.some((k) => before[k] !== after[k])) changed = true;
      }
      saveJobs(existing.id);
      if (changed) summary.updated++;
      else summary.unchanged++;
    }

    db.prepare(`
      INSERT INTO import_runs (brand_id, started_at, queue_modified_at, created, updated, new_versions,
        unchanged, skipped, warnings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      brandId,
      nowIso,
      queueModifiedAt,
      summary.created,
      summary.updated,
      summary.newVersions,
      summary.unchanged,
      summary.skipped.length,
      JSON.stringify([...summary.warnings, ...summary.skipped.map((s) => `row ${s.row} ${s.postId}: ${s.reason}`)]),
    );
  })();

  return summary;
}
