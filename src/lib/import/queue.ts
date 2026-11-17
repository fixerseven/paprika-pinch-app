/**
 * Turn rows of the old `post-queue.csv` (plus `postiz-state.json`) into Pinch posts.
 * Pure functions: no database and no file system, so they're easy to test.
 */

export type Part = "feed" | "story" | "reel";
export type PostState =
  | "review"
  | "approved"
  | "scheduled"
  | "published"
  | "failed"
  | "revise"
  | "held"
  | "rejected";

export interface Flag {
  code: string;
  text: string;
}

export interface MediaItem {
  part: Part;
  position: number;
  path: string;
  kind: "image" | "video";
}

export interface LegacyJob {
  part: Part;
  postizPostId: string;
  status: "draft" | "scheduled";
  publishAt: string | null;
}

export interface ImportedPost {
  /** Line number in the CSV (header is line 1). */
  row: number;
  externalId: string;
  localDate: string;
  localTime: string;
  title: string;
  track: string | null;
  owner: string | null;
  notes: string | null;
  queueStatus: string;
  state: PostState;
  stateReason: string;
  flags: Flag[];
  caption: string | null;
  captionRef: string | null;
  media: MediaItem[];
  parts: Part[];
  legacyJobs: LegacyJob[];
}

export interface LegacyStateEntry {
  drafted_at?: string;
  postiz_ids?: string[];
  scheduled?: { at?: string; publish?: string; by?: string };
  note?: string;
}

export interface MapContext {
  /** Regex every post id of this brand must match. */
  postIdPattern: string;
  /** The brand's usual slot times, "HH:MM". */
  slots: string[];
  /** postiz-state.json, keyed "<post_id>:<part>". */
  legacyState: Record<string, LegacyStateEntry>;
  /** Look up a caption section; return undefined if the file can't be read. */
  caption: (file: string, key: string) => { found: boolean; text?: string } | undefined;
  /** Optional: does this media path exist in the brand's folder? */
  fileExists?: (relPath: string) => boolean;
}

export interface MapResult {
  posts: ImportedPost[];
  skipped: { row: number; postId: string; reason: string }[];
  warnings: string[];
}

const PARTS: Part[] = ["feed", "story", "reel"];
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;

/** A media or caption path must stay inside the brand's own folder. */
export function safeRelPath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) return false;
  return !p.split(/[\\/]/).some((seg) => seg === "..");
}

export function mapQueue(rows: Record<string, string>[], ctx: MapContext): MapResult {
  const pattern = new RegExp(ctx.postIdPattern);
  const seen = new Set<string>();
  const posts: ImportedPost[] = [];
  const skipped: MapResult["skipped"] = [];
  const warnings: string[] = [];

  rows.forEach((row, i) => {
    const rowNo = i + 2; // header is line 1
    const postId = row.post_id ?? "";
    const skip = (reason: string) => skipped.push({ row: rowNo, postId, reason });

    if (!postId) return skip("no post_id");
    if (!pattern.test(postId)) return skip(`post id doesn't belong to this brand (must match ${ctx.postIdPattern})`);
    if (seen.has(postId)) return skip("post_id appears twice in the queue; kept the first");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date ?? "")) return skip(`bad date "${row.date}"`);
    if (!/^\d{2}:\d{2}$/.test(row.time ?? "")) return skip(`bad time "${row.time}"`);
    seen.add(postId);

    const flags: Flag[] = [];
    const media: MediaItem[] = [];
    for (const part of PARTS) {
      const cell = row[`${part}_file`] ?? "";
      const paths = cell.split(";").map((s) => s.trim()).filter(Boolean);
      paths.forEach((p, idx) => {
        if (!safeRelPath(p)) {
          warnings.push(`${postId}: ignored ${part} path outside the brand folder: ${p}`);
          flags.push({ code: "bad_media_path", text: `A ${part} file points outside this brand's folder` });
          return;
        }
        if (ctx.fileExists && !ctx.fileExists(p)) {
          flags.push({ code: "missing_media", text: `${part} file not found: ${p.split("/").pop()}` });
        }
        media.push({ part, position: idx + 1, path: p, kind: VIDEO.test(p) ? "video" : "image" });
      });
    }
    const parts = PARTS.filter((p) => media.some((m) => m.part === p));

    // Caption
    let caption: string | null = null;
    let captionRef: string | null = row.caption_file || null;
    if (captionRef) {
      const [file, key = postId] = captionRef.split("#");
      if (!safeRelPath(file)) {
        warnings.push(`${postId}: ignored caption path outside the brand folder: ${file}`);
        captionRef = null;
      } else {
        const res = ctx.caption(file, key);
        if (!res) flags.push({ code: "caption_missing", text: "Caption file couldn't be read" });
        else if (!res.found) flags.push({ code: "caption_missing", text: `No "## ${key}" section in the caption file` });
        else caption = res.text ?? "";
      }
    } else if (parts.some((p) => p !== "story")) {
      flags.push({ code: "caption_missing", text: "No caption" });
    }
    if (caption) {
      const markers = ["⚑", "[PRICE", "[OFFER", "TBD", "*Note", "*Add", "(Same fine print"].filter((m) =>
        caption!.includes(m),
      );
      if (markers.length) flags.push({ code: "caption_unfinished", text: `Caption still has ${markers.join(", ")}` });
    }

    // Flags from notes and parts
    const notes = row.notes || "";
    const check = /Check the morning it posts:\s*(?:On the morning:\s*)?(.+)$/i.exec(notes);
    if (check) flags.push({ code: "check_fact", text: `Check this fact today: ${check[1].trim()}` });
    if (parts.includes("reel") && /silent/i.test(notes)) flags.push({ code: "silent_reel", text: "Reel has no sound" });
    if (parts.includes("story")) flags.push({ code: "fb_story_manual", text: "Facebook story is manual" });
    if (!ctx.slots.includes(row.time)) flags.push({ code: "off_slot", text: `${row.time} isn't one of the usual slots` });

    // Legacy Postiz state
    const legacyJobs: LegacyJob[] = [];
    for (const part of PARTS) {
      const entry = ctx.legacyState[`${postId}:${part}`];
      if (!entry?.postiz_ids?.length) continue;
      const publishAt = entry.scheduled?.publish ? new Date(entry.scheduled.publish).toISOString() : null;
      for (const id of entry.postiz_ids) {
        legacyJobs.push({ part, postizPostId: id, status: publishAt ? "scheduled" : "draft", publishAt });
      }
    }
    const scheduledParts = new Set(legacyJobs.filter((j) => j.status === "scheduled").map((j) => j.part));
    const draftedParts = new Set(legacyJobs.map((j) => j.part));

    // State
    const status = (row.status || "").trim();
    const lower = status.toLowerCase();
    let state: PostState;
    let stateReason: string;
    if (lower.startsWith("posted")) {
      state = "published";
      stateReason = `Queue says "${status}"`;
    } else if (lower.startsWith("dropped")) {
      state = "rejected";
      stateReason = status.replace(/^dropped:?\s*/i, "") || "Dropped in the queue";
    } else if (scheduledParts.size > 0) {
      state = "scheduled";
      stateReason = "Scheduled in Postiz by the old pipeline";
      if (lower !== "ready") {
        flags.push({ code: "conflict", text: `Queue says "${status}" but Postiz already has it scheduled` });
      }
      const unscheduled = parts.filter((p) => !scheduledParts.has(p));
      if (unscheduled.length) {
        flags.push({ code: "partly_scheduled", text: `Not scheduled in Postiz: ${unscheduled.join(", ")}` });
      }
    } else if (lower === "ready") {
      state = "approved";
      stateReason = "Marked ready in the old queue";
      if (draftedParts.size) {
        flags.push({
          code: "legacy_needs_yes",
          text: "Drafted in Postiz but not scheduled: still needs a yes in the old flow until this brand moves to Pinch",
        });
      }
    } else {
      state = "held";
      stateReason = status ? status.replace(/^(hold|check):?\s*/i, "") || status : "No status in the queue";
    }

    posts.push({
      row: rowNo,
      externalId: postId,
      localDate: row.date,
      localTime: row.time,
      title: row.title || postId,
      track: row.track || null,
      owner: row.owner || null,
      notes: notes || null,
      queueStatus: status,
      state,
      stateReason,
      flags,
      caption,
      captionRef,
      media,
      parts,
      legacyJobs,
    });
  });

  return { posts, skipped, warnings };
}
