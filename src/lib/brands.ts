import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db";

export interface ChannelConfig {
  key: string;
  platform: string;
  name: string;
  postizIntegrationId: string | null;
  active?: boolean;
  notes?: string;
}

export interface BrandConfig {
  slug: string;
  name: string;
  colour: string;
  timezone: string;
  slots: string[];
  approvers: string[];
  postIdPattern: string;
  rootEnv: string;
  queue: { csv: string; postizState: string };
  channels: ChannelConfig[];
  /** Short reminders shown before reviewing this page's posts. */
  rules?: string[];
}

export function loadBrandConfig(file = path.join(process.cwd(), "config", "brands.json")): BrandConfig[] {
  return (JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as { brands: BrandConfig[] }).brands;
}

/** Each page's review reminders, by slug. */
export function pageRules(brands: BrandConfig[] = loadBrandConfig()): Record<string, string[]> {
  return Object.fromEntries(brands.map((b) => [b.slug, b.rules ?? []]));
}

/** The brand's folder on this machine, or undefined if its env var isn't set. */
export function brandRoot(brand: Pick<BrandConfig, "rootEnv">): string | undefined {
  const v = process.env[brand.rootEnv];
  return v ? path.resolve(v) : undefined;
}

/** Insert or update brands and channels from config. Returns slug -> brand id. */
export function syncBrands(db: DB, brands: BrandConfig[]): Map<string, number> {
  const ids = new Map<string, number>();
  const upsertBrand = db.prepare(`
    INSERT INTO brands (slug, name, colour, timezone, slots, approvers, post_id_pattern)
    VALUES (@slug, @name, @colour, @timezone, @slots, @approvers, @postIdPattern)
    ON CONFLICT (slug) DO UPDATE SET name = excluded.name, colour = excluded.colour,
      timezone = excluded.timezone, slots = excluded.slots, approvers = excluded.approvers,
      post_id_pattern = excluded.post_id_pattern
    RETURNING id`);
  const findChannel = db.prepare("SELECT id, brand_id FROM channels WHERE key = ?");
  const upsertChannel = db.prepare(`
    INSERT INTO channels (brand_id, key, platform, name, postiz_integration_id, active, notes)
    VALUES (@brandId, @key, @platform, @name, @postizIntegrationId, @active, @notes)
    ON CONFLICT (key) DO UPDATE SET platform = excluded.platform, name = excluded.name,
      postiz_integration_id = excluded.postiz_integration_id, active = excluded.active, notes = excluded.notes`);

  db.transaction(() => {
    for (const b of brands) {
      const { id } = upsertBrand.get({
        ...b,
        slots: JSON.stringify(b.slots),
        approvers: JSON.stringify(b.approvers),
      }) as { id: number };
      ids.set(b.slug, id);
      for (const c of b.channels) {
        const existing = findChannel.get(c.key) as { brand_id: number } | undefined;
        if (existing && existing.brand_id !== id) {
          throw new Error(`channel ${c.key} already belongs to another brand`);
        }
        upsertChannel.run({
          brandId: id,
          key: c.key,
          platform: c.platform,
          name: c.name,
          postizIntegrationId: c.postizIntegrationId ?? null,
          active: c.active === false ? 0 : 1,
          notes: c.notes ?? null,
        });
      }
    }
  })();
  return ids;
}
