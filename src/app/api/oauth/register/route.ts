import { getDb } from "@/lib/db";
import { OAuthError, registerClient } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const MAX_CLIENTS = 500;

/** RFC 7591: Claude registers itself before sending Nath to the consent screen. Registering grants nothing. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "Send JSON" }, { status: 400 });
  }
  const db = getDb();
  // Tidy apps that registered but were never allowed, so open registration can't fill the disk.
  db.prepare(
    "DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM oauth_grants)",
  ).run(new Date(Date.now() - 86400_000).toISOString());
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as { n: number };
  if (n >= MAX_CLIENTS) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  try {
    return Response.json(registerClient(db, body), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OAuthError) return Response.json({ error: e.code, error_description: e.message }, { status: e.status });
    throw e;
  }
}
