/**
 * See and end Claude connections.
 *
 *   npm run connections             # list
 *   npm run connections revoke 3    # end connection 3
 *   npm run connections revoke-all  # end every connection
 */
import { openDb } from "../src/lib/db";
import { listGrants, revokeGrant } from "../src/lib/oauth";

const db = openDb(process.env.PINCH_DB_PATH || "./data/pinch.db");
const [cmd, arg] = process.argv.slice(2);

if (cmd === "revoke" && arg) {
  console.log(revokeGrant(db, Number(arg)) ? `Ended connection ${arg}.` : `No live connection ${arg}.`);
} else if (cmd === "revoke-all") {
  const live = listGrants(db).filter((g) => !g.revokedAt);
  for (const g of live) revokeGrant(db, g.id);
  console.log(`Ended ${live.length} connection(s).`);
} else {
  const rows = listGrants(db);
  if (!rows.length) console.log("No Claude connections yet.");
  for (const g of rows)
    console.log(
      `${String(g.id).padStart(3)}  ${g.app.padEnd(24)} connected ${g.connectedAt.slice(0, 16)}  last used ${(g.lastUsedAt ?? "-").slice(0, 16)}${g.revokedAt ? "  (ended)" : ""}`,
    );
}
