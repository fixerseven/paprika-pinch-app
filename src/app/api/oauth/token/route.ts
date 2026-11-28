import { getDb } from "@/lib/db";
import { OAuthError, authClient, exchangeCode, refreshTokens } from "@/lib/oauth";
import { clientCreds, readForm } from "@/lib/oauthHttp";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** Swap a one-time code (with its PKCE verifier) or a refresh token for new tokens. */
export async function POST(req: Request) {
  const form = await readForm(req);
  const db = getDb();
  try {
    const creds = clientCreds(req, form);
    const client = authClient(db, creds.id, creds.secret);
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const out = exchangeCode(db, {
        client,
        code: form.get("code") ?? "",
        redirectUri: form.get("redirect_uri"),
        verifier: form.get("code_verifier") ?? "",
      });
      return Response.json(out, { headers: NO_STORE });
    }
    if (grant === "refresh_token") {
      return Response.json(refreshTokens(db, { client, refreshToken: form.get("refresh_token") ?? "" }), { headers: NO_STORE });
    }
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  } catch (e) {
    if (e instanceof OAuthError)
      return Response.json({ error: e.code, error_description: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
}
