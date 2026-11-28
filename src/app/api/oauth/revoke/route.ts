import { getDb } from "@/lib/db";
import { OAuthError, authClient, revokeToken } from "@/lib/oauth";
import { clientCreds, readForm } from "@/lib/oauthHttp";

export const dynamic = "force-dynamic";

/** RFC 7009: Claude disconnecting. Ends the whole connection the token belongs to. */
export async function POST(req: Request) {
  const form = await readForm(req);
  const db = getDb();
  let client;
  try {
    const creds = clientCreds(req, form);
    client = authClient(db, creds.id, creds.secret);
  } catch (e) {
    if (e instanceof OAuthError) return Response.json({ error: e.code, error_description: e.message }, { status: e.status });
    throw e;
  }
  const token = form.get("token");
  if (token) revokeToken(db, token, client.id);
  return new Response(null, { status: 200 });
}
