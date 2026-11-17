import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "@/lib/db";
import { loadBrandConfig, syncBrands, type BrandConfig } from "@/lib/brands";
import { importBrand } from "@/lib/import/importer";

const FIX = path.join(__dirname, "fixtures");
let db: DB;
let brands: BrandConfig[];
const andar = () => brands.find((b) => b.slug === "andar")!;
const nest = () => brands.find((b) => b.slug === "nest")!;
const post = (brand: string, id: string) =>
  db
    .prepare("SELECT p.* FROM posts p JOIN brands b ON b.id = p.brand_id WHERE b.slug = ? AND p.external_id = ?")
    .get(brand, id) as Record<string, any>;
const flagCodes = (p: Record<string, any>) => JSON.parse(p.flags).map((f: { code: string }) => f.code);

beforeEach(() => {
  db = openDb(":memory:");
  brands = loadBrandConfig();
  syncBrands(db, brands);
});

describe("importBrand: Andar", () => {
  it("imports ready rows with captions, media, channels and legacy Postiz jobs", () => {
    const s = importBrand(db, andar(), path.join(FIX, "andar"), { now: new Date("2026-11-16T03:00:00Z") });
    expect(s.created).toBe(4); // A31 comes in flagged, with its bad path dropped
    expect(s.skipped.map((x) => x.postId).sort()).toEqual(["B99"]);

    const a221 = post("andar", "A2-21");
    expect(a221.state).toBe("scheduled");
    expect(a221.scheduled_at).toBe("2026-11-18T11:00:00.000Z");
    expect(flagCodes(a221)).toEqual(expect.arrayContaining(["check_fact", "fb_story_manual"]));
    const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(a221.current_version_id) as any;
    expect(v.caption).toContain("₱500,000");
    expect(v.caption).not.toContain("---");

    const jobs = db.prepare("SELECT * FROM publish_jobs WHERE post_id = ?").all(a221.id) as any[];
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.status === "scheduled")).toBe(true);

    const targets = db
      .prepare(
        "SELECT c.key, pc.part FROM post_channels pc JOIN channels c ON c.id = pc.channel_id WHERE post_id = ? ORDER BY 1, 2",
      )
      .all(a221.id) as any[];
    expect(targets).toEqual([
      { key: "andar-facebook", part: "feed" },
      { key: "andar-instagram", part: "feed" },
      { key: "andar-instagram", part: "story" },
    ]);
  });

  it("keeps carousel order and flags drafts that still need the old yes", () => {
    importBrand(db, andar(), path.join(FIX, "andar"));
    const a29 = post("andar", "A29");
    expect(a29.state).toBe("approved");
    expect(flagCodes(a29)).toContain("legacy_needs_yes");
    const media = db
      .prepare("SELECT position, path FROM media WHERE version_id = ? ORDER BY position")
      .all(a29.current_version_id) as any[];
    expect(media.map((m) => m.position)).toEqual([1, 2, 3]);
    expect(media[2].path).toContain("a29 3");
  });

  it("flags silent reels and drops paths that leave the brand folder", () => {
    const s = importBrand(db, andar(), path.join(FIX, "andar"));
    expect(flagCodes(post("andar", "A30"))).toContain("silent_reel");
    const a31 = post("andar", "A31");
    expect(flagCodes(a31)).toContain("bad_media_path");
    const media = db.prepare("SELECT * FROM media WHERE version_id = ?").all(a31.current_version_id);
    expect(media).toHaveLength(0);
    expect(s.warnings.join("\n")).toContain("outside the brand folder");
  });

  it("is safe to run twice", () => {
    importBrand(db, andar(), path.join(FIX, "andar"));
    const s2 = importBrand(db, andar(), path.join(FIX, "andar"));
    expect(s2.created).toBe(0);
    expect(s2.updated).toBe(0);
    expect(s2.unchanged).toBe(4);
    expect((db.prepare("SELECT COUNT(*) n FROM versions").get() as any).n).toBe(4);
    expect((db.prepare("SELECT COUNT(*) n FROM publish_jobs").get() as any).n).toBe(5);
  });

  it("keeps a post's Pinch decision, and sends it back to review when the content changes", () => {
    importBrand(db, andar(), path.join(FIX, "andar"));
    const a30 = post("andar", "A30");
    db.prepare("UPDATE posts SET state = 'rejected' WHERE id = ?").run(a30.id);
    db.prepare("INSERT INTO decisions (post_id, action, actor) VALUES (?, 'reject', 'nath')").run(a30.id);

    importBrand(db, andar(), path.join(FIX, "andar"));
    expect(post("andar", "A30").state).toBe("rejected");

    db.prepare("UPDATE versions SET content_hash = 'old' WHERE post_id = ?").run(a30.id);
    const s = importBrand(db, andar(), path.join(FIX, "andar"));
    expect(s.newVersions).toBe(1);
    const after = post("andar", "A30");
    expect(after.state).toBe("review");
    const v = db.prepare("SELECT number FROM versions WHERE id = ?").get(after.current_version_id) as any;
    expect(v.number).toBe(2);
  });
});

describe("importBrand: Nest", () => {
  it("maps posted, dropped, held and conflicting rows", () => {
    const s = importBrand(db, nest(), path.join(FIX, "nest"));
    expect(post("nest", "B1-04").state).toBe("published");
    expect(post("nest", "B22").state).toBe("rejected");
    expect(post("nest", "B22").state_reason).toBe("replaced by B23 weekend hours (Nov 6)");
    expect(post("nest", "B05").state).toBe("held");
    expect(post("nest", "B05").state_reason).toBe("zone facts");
    expect(post("nest", "Q06").state).toBe("approved");

    const b23 = post("nest", "B23");
    expect(b23.state).toBe("scheduled");
    expect(flagCodes(b23)).toEqual(expect.arrayContaining(["conflict", "caption_unfinished"]));

    // Note lines are stripped from Nest captions.
    const q06 = post("nest", "Q06");
    const v = db.prepare("SELECT caption FROM versions WHERE id = ?").get(q06.current_version_id) as any;
    expect(v.caption).toBe("Good morning.\nShow up. The rest follows.\n\n#DoTheNextThing");

    // An Andar-style id in Nest's queue is refused, never imported into either brand.
    expect(s.skipped.map((x) => x.postId)).toEqual(["A12"]);
    expect(post("andar", "A12")).toBeUndefined();
  });
});

describe("brand separation", () => {
  it("refuses to target another brand's channel", () => {
    importBrand(db, andar(), path.join(FIX, "andar"));
    const a29 = post("andar", "A29");
    const nestFb = db.prepare("SELECT id FROM channels WHERE key = 'nest-facebook'").get() as any;
    expect(() =>
      db.prepare("INSERT INTO post_channels (post_id, channel_id, part) VALUES (?, ?, 'feed')").run(a29.id, nestFb.id),
    ).toThrow(/its own brand/);
  });
});
