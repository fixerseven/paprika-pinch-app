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
