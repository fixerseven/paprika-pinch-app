import { describe, expect, it } from "vitest";
import { foldDay, groupByPage, monogram, orderByPage, relDay } from "../src/lib/pages";

describe("monogram", () => {
  it("uses the first letters of two words, or the first two letters of one", () => {
    expect(monogram("Nest Workspaces")).toBe("NW");
    expect(monogram("Andar")).toBe("AN");
    expect(monogram("Kubo Café")).toBe("KC");
    expect(monogram("")).toBe("?");
  });
});

describe("groupByPage", () => {
  const items = [
    { id: 1, brandSlug: "andar" },
    { id: 2, brandSlug: "nest" },
    { id: 3, brandSlug: "andar" },
    { id: 4, brandSlug: "kubo" },
  ];
  it("keeps pages in order of first appearance", () => {
    expect(groupByPage(items).map((g) => [g.slug, g.items.map((i) => i.id)])).toEqual([
      ["andar", [1, 3]],
      ["nest", [2]],
      ["kubo", [4]],
    ]);
  });
  it("orders items page by page", () => {
    expect(orderByPage(items).map((i) => i.id)).toEqual([1, 3, 2, 4]);
  });
});

describe("relDay", () => {
  it("names today and tomorrow", () => {
    expect(relDay("2026-11-28", "2026-11-28")).toBe("Today");
    expect(relDay("2026-11-29", "2026-11-28")).toBe("Tomorrow");
    expect(relDay("2026-11-30", "2026-11-28")).toBe("Mon 30 Nov");
  });
});

describe("foldDay", () => {
  it("groups by status in a fixed order and drops empty groups", () => {
    const out = foldDay(["s", "r", "s", "f"], (x) => (x === "s" ? "scheduled" : x === "r" ? "review" : "fix"));
    expect(out.map((g) => [g.key, g.items.length])).toEqual([
      ["fix", 1],
      ["review", 1],
      ["scheduled", 2],
    ]);
  });
});
