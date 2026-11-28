/**
 * Helpers for showing many pages (brands) without the screen exploding.
 * Pinch switches to page tiles and page grouping once there are MANY_PAGES or more.
 */
import { addDays } from "./time";
import { shortDay } from "./labels";

export const MANY_PAGES = 3;
/** A day with more posts than this folds into one line per status. */
export const FOLD_OVER = 6;

/** Two letters that name a page: "Andar" -> "AN", "Nest Workspaces" -> "NW". */
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  const s = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return s.toUpperCase();
}

export interface PageGroup<T> {
  slug: string;
  items: T[];
}

/** Group items by page, keeping the order in which each page first appears. */
export function groupByPage<T extends { brandSlug: string }>(items: T[]): PageGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const g = groups.get(it.brandSlug);
    if (g) g.push(it);
    else groups.set(it.brandSlug, [it]);
  }
  return [...groups].map(([slug, items]) => ({ slug, items }));
}

/** Items reordered so each page's items sit together, pages in order of their first item. */
export function orderByPage<T extends { brandSlug: string }>(items: T[]): T[] {
  return groupByPage(items).flatMap((g) => g.items);
}

/** "Today", "Tomorrow", or "Sat 29 Nov". */
export function relDay(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return shortDay(date);
}

export type FoldKey = "fix" | "review" | "with" | "scheduled";

/** Split a busy day into status groups, in the order they should show. Empty groups are left out. */
export function foldDay<T>(items: T[], keyOf: (t: T) => FoldKey): { key: FoldKey; items: T[] }[] {
  const order: FoldKey[] = ["fix", "review", "with", "scheduled"];
  return order
    .map((key) => ({ key, items: items.filter((t) => keyOf(t) === key) }))
    .filter((g) => g.items.length > 0);
}
