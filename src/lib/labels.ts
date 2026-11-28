import type { PostState } from "./import/queue";

export const STATE_LABEL: Record<PostState, string> = {
  review: "To review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Posted",
  failed: "Failed",
  revise: "Sent back",
  held: "On hold",
  rejected: "Dropped",
};

export const STATE_ORDER: PostState[] = [
  "review",
  "approved",
  "scheduled",
  "published",
  "revise",
  "held",
  "failed",
  "rejected",
];

export const PLATFORM_SHORT: Record<string, string> = {
  facebook: "FB",
  instagram: "IG",
  threads: "Threads",
  linkedin: "in",
  tiktok: "TikTok",
  x: "X",
};

export function formatDay(date: string): { weekday: string; day: string; month: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    day: d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" }),
    month: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
  };
}

export function formatWhen(iso: string, timeZone = "Asia/Manila"): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Flags worth a line on the review screen. Everything else (Facebook story is manual,
 * off-slot time, old-flow notes) stays in Details, so the screen only speaks up when
 * something needs a look ("due") or is broken ("bad").
 */
export const FLAG_TONE: Record<string, "due" | "bad"> = {
  check_fact: "due",
  silent_reel: "due",
  caption_unfinished: "due",
  conflict: "due",
  partly_scheduled: "due",
  caption_missing: "bad",
  missing_media: "bad",
  bad_media_path: "bad",
};

export function loudFlags<T extends { code: string }>(flags: T[]): (T & { tone: "due" | "bad" })[] {
  return flags.filter((f) => FLAG_TONE[f.code]).map((f) => ({ ...f, tone: FLAG_TONE[f.code] }));
}

/** "Fri 27 Nov" */
export function shortDay(date: string): string {
  const d = formatDay(date);
  return `${d.weekday} ${d.day} ${d.month}`;
}
