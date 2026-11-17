import type { DB } from "./db";
import type { Part } from "./import/queue";

/**
 * Which of a brand's active channels each part goes to.
 * Postiz can't post Facebook stories, so a story only targets Instagram.
 * Only the brand's own channels are ever returned.
 */
export function targetsFor(db: DB, brandId: number, parts: Part[]): { channelId: number; part: Part }[] {
  const channels = db
    .prepare("SELECT id, platform FROM channels WHERE brand_id = ? AND active = 1")
    .all(brandId) as { id: number; platform: string }[];
  const out: { channelId: number; part: Part }[] = [];
  for (const part of parts) {
    const platforms = part === "story" ? ["instagram"] : ["facebook", "instagram"];
    for (const c of channels) if (platforms.includes(c.platform)) out.push({ channelId: c.id, part });
  }
  return out;
}
