import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "@/lib/db";
import { loadBrandConfig, syncBrands, type BrandConfig } from "@/lib/brands";
import { importBrand } from "@/lib/import/importer";
import { decide, getReviewStack, hasYes, listRevisions } from "@/lib/review";
import { submitPost } from "@/lib/maker";

const FIX = path.join(__dirname, "fixtures");
const NOW = new Date("2026-11-16T03:00:00Z");
let db: DB;
let brands: BrandConfig[];
const root = (b: BrandConfig) => path.join(FIX, b.slug);
const at = (s: number) => new Date(NOW.getTime() + s * 1000);

const newPost = (over: Record<string, unknown> = {}) =>
  submitPost(
    db,
    brands,
    {
      brand: "andar",
      externalId: "A40",
      date: "2026-11-20",
      time: "12:00",
      title: "Workshop open day",
      caption: "Come see the workshop.",
      media: [{ part: "feed", path: "Posts/Test/feed/a2-21 - feed.png" }],
      ...over,
    },
    { maker: "ac", root, now: NOW },
  );

beforeEach(() => {
  db = openDb(":memory:");
  brands = loadBrandConfig();
  syncBrands(db, brands);
});

describe("maker API", () => {
  it("creates a post in review with its brand's channels", () => {
    const r = newPost();
    expect(r).toMatchObject({ created: true, state: "review", version: 1 });
    const chans = db
      .prepare("SELECT c.key FROM post_channels pc JOIN channels c ON c.id = pc.channel_id WHERE pc.post_id = ?")
      .all(r.id)
      .map((x: any) => x.key);
    expect(chans.sort()).toEqual(["andar-facebook", "andar-instagram"]);
  });

  it("refuses ids and files from another brand", () => {
    expect(() => newPost({ externalId: "B13" })).toThrow(/doesn't look like a Andar post id/);
    expect(() => newPost({ media: [{ part: "feed", path: "../nest/Designs/x.png" }] })).toThrow(/relative/);
    expect(() => newPost({ media: [{ part: "feed", path: "Posts/nope.png" }] })).toThrow(/not found/);
    expect(() => newPost({ brand: "nest", externalId: "A40" })).toThrow(/Nest Workspaces post id/);
  });

  it("a revision adds a version and needs a fresh yes", () => {
    const r = newPost();
    const v1 = db.prepare("SELECT current_version_id AS v FROM posts WHERE id = ?").get(r.id) as any;
    decide(db, r.id, "approve", { actor: "nath", versionId: v1.v, now: NOW });
    expect(hasYes(db, r.id, v1.v)).toBe(true);

    const r2 = newPost({ caption: "Come see the new workshop.", note: "Fixed wording" });
    expect(r2).toMatchObject({ created: false, version: 2, state: "review" });
    const v2 = db.prepare("SELECT current_version_id AS v FROM posts WHERE id = ?").get(r.id) as any;
    expect(hasYes(db, r.id, v2.v)).toBe(false);
    // An approval for the old version is refused.
    expect(() => decide(db, r.id, "approve", { actor: "nath", versionId: v1.v, now: NOW })).toThrow(/newer version/);
  });

  it("won't touch a post that is already scheduled in Postiz", () => {
    importBrand(db, brands[0], root(brands[0]), { now: NOW });
    expect(() => newPost({ externalId: "A2-21" })).toThrow(/already scheduled/);
  });

  it("the importer leaves maker posts alone", () => {
    importBrand(db, brands[0], root(brands[0]), { now: NOW });
    // A29 came from the queue; a maker revises it, so Pinch owns it from now on.
    newPost({ externalId: "A29", title: "Maker's version" });
    const s = importBrand(db, brands[0], root(brands[0]), { now: NOW });
    expect(s.skipped.map((x) => x.postId)).toContain("A29");
    const p = db.prepare("SELECT title, state, source FROM posts WHERE external_id = 'A29'").get() as any;
    expect(p).toMatchObject({ title: "Maker's version", state: "review", source: "api" });
  });
});

describe("review decisions", () => {
  it("approve, reject and send back move the post and are recorded", () => {
    const a = newPost();
    const b = newPost({ externalId: "A41" });
    const c = newPost({ externalId: "A42" });
    const ver = (id: number) => (db.prepare("SELECT current_version_id AS v FROM posts WHERE id = ?").get(id) as any).v;

    expect(decide(db, a.id, "approve", { actor: "nath", versionId: ver(a.id), now: NOW }).state).toBe("approved");
    expect(decide(db, b.id, "reject", { actor: "nath", now: NOW }).state).toBe("rejected");
    expect(() => decide(db, c.id, "revise", { actor: "nath", now: NOW })).toThrow(/what needs to change/);
    expect(decide(db, c.id, "revise", { actor: "nath", comment: "Brighter photo", now: NOW }).state).toBe("revise");

    const rev = listRevisions(db);
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ externalId: "A42", comment: "Brighter photo", by: "nath" });
  });

  it("approve needs the version the reviewer saw", () => {
    const a = newPost();
    expect(() => decide(db, a.id, "approve", { actor: "nath", now: NOW })).toThrow(/which version/);
  });

  it("undo puts the post back, only for the same person and only briefly", () => {
    const a = newPost();
    decide(db, a.id, "reject", { actor: "nath", now: NOW });
    expect(() => decide(db, a.id, "undo", { actor: "ac", now: at(2) })).toThrow(/Only the person/);
    expect(decide(db, a.id, "undo", { actor: "nath", now: at(3) }).state).toBe("review");
    expect(() => decide(db, a.id, "undo", { actor: "nath", now: at(4) })).toThrow(/Nothing to undo/);

    decide(db, a.id, "reject", { actor: "nath", now: at(10) });
    expect(() => decide(db, a.id, "undo", { actor: "nath", now: at(60) })).toThrow(/Too late/);
  });

  it("an undone approval is no longer a yes", () => {
    const a = newPost();
    const v = (db.prepare("SELECT current_version_id AS v FROM posts WHERE id = ?").get(a.id) as any).v;
    decide(db, a.id, "approve", { actor: "nath", versionId: v, now: NOW });
    decide(db, a.id, "undo", { actor: "nath", now: at(1) });
    expect(hasYes(db, a.id, v)).toBe(false);
  });

  it("scheduled and published posts can't be decided here", () => {
    importBrand(db, brands[0], root(brands[0]), { now: NOW });
    const p = db.prepare("SELECT id FROM posts WHERE external_id = 'A2-21'").get() as any;
    expect(() => decide(db, p.id, "reject", { actor: "nath", now: NOW })).toThrow(/scheduled/);
  });
});

describe("review stack", () => {
  it("shows new posts and queue-ready posts without a yes, soonest first", () => {
    importBrand(db, brands[0], root(brands[0]), { now: NOW });
    newPost();
    const stack = getReviewStack(db, { now: NOW });
    const ids = stack.map((c) => c.externalId);
    expect(ids).toContain("A40");
    expect(ids).not.toContain("A2-21"); // scheduled in Postiz
    const ready = stack.filter((c) => c.needsYes);
    expect(ready.length).toBeGreaterThan(0);
    expect([...stack].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))).toEqual(stack);

    // Saying yes takes a queue-ready post off the stack.
    const first = ready[0];
    decide(db, first.id, "approve", { actor: "nath", versionId: first.versionId, now: NOW });
    expect(getReviewStack(db, { now: NOW }).map((c) => c.id)).not.toContain(first.id);
  });

  it("filters by brand", () => {
    newPost();
    importBrand(db, brands[1], root(brands[1]), { now: NOW });
    expect(getReviewStack(db, { brand: "nest", now: NOW }).every((c) => c.brandSlug === "nest")).toBe(true);
    expect(getReviewStack(db, { brand: "andar", now: NOW }).every((c) => c.brandSlug === "andar")).toBe(true);
  });
});

describe("channelIssues", () => {
  it("lists a channel with an expired login that upcoming posts use, once", async () => {
    const { channelIssues } = await import("@/lib/queries");
    newPost();
    newPost({ externalId: "A41" });
    expect(channelIssues(db, NOW)).toEqual([]);
    db.prepare("UPDATE channels SET token_expires_at = ? WHERE key = 'andar-instagram'").run("2026-11-15T00:00:00Z");
    expect(channelIssues(db, NOW)).toEqual([
      { brandSlug: "andar", brandName: "Andar", platform: "instagram", reason: "expired", posts: 2 },
    ]);
  });
});
