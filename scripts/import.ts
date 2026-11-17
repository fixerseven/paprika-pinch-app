/**
 * Import the old post queues into Pinch (read-only on the queue folders).
 *
 *   npm run import            # every brand whose folder env var is set
 *   npm run import -- andar   # one brand
 */
import { openDb } from "../src/lib/db";
import { brandRoot, loadBrandConfig, syncBrands } from "../src/lib/brands";
import { importBrand } from "../src/lib/import/importer";

const only = process.argv.slice(2);
const db = openDb(process.env.PINCH_DB_PATH || "./data/pinch.db");
const brands = loadBrandConfig();
syncBrands(db, brands);

let failed = false;
for (const brand of brands) {
  if (only.length && !only.includes(brand.slug)) continue;
  const root = brandRoot(brand);
  if (!root) {
    console.log(`${brand.name}: skipped, ${brand.rootEnv} isn't set`);
    continue;
  }
  try {
    const s = importBrand(db, brand, root);
    console.log(
      `${brand.name}: ${s.created} new, ${s.updated} updated, ${s.newVersions} new versions, ` +
        `${s.unchanged} unchanged, ${s.skipped.length} skipped`,
    );
    for (const sk of s.skipped) console.log(`  skipped row ${sk.row} ${sk.postId}: ${sk.reason}`);
    for (const w of s.warnings) console.log(`  warning: ${w}`);
  } catch (e) {
    failed = true;
    console.error(`${brand.name}: import failed: ${(e as Error).message}`);
  }
}
db.close();
process.exit(failed ? 1 : 0);
