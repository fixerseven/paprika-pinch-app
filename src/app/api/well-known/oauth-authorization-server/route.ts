import { publicUrl } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";

/** RFC 8414: Pinch's OAuth endpoints. */
export function GET(req: Request) {
  const base = publicUrl(req);
  return Response.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: ["pinch"],
    },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
