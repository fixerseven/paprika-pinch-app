import crypto from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/lib/db";
import { buildMcpServer, type Caller } from "@/lib/mcp";
import { touchGrant, verifyAccess } from "@/lib/oauth";
import { publicUrl } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => {
  const h = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

/**
 * Who is calling: Nath through a Claude connector (OAuth access token), or a
 * maker with the maker token. Anyone else gets a 401 that points Claude at
 * the sign-in metadata, which starts the OAuth flow.
 */
function callerFor(req: Request): Caller | null {
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!token) return null;
  const db = getDb();
  const who = verifyAccess(db, token);
  if (who) {
    touchGrant(db, who.grantId);
    return { role: "approver", actor: who.actor, app: who.app };
  }
  const maker = process.env.PINCH_MAKER_TOKEN;
  if (maker && same(token, maker)) {
    const name = (req.headers.get("x-pinch-maker") ?? "maker").replace(/[^\w .-]/g, "").slice(0, 40) || "maker";
    return { role: "maker", maker: name };
  }
  return null;
}

async function handle(req: Request): Promise<Response> {
  const base = publicUrl(req);
  const caller = callerFor(req);
  if (!caller) {
    return Response.json(
      { error: "invalid_token", error_description: "Connect Pinch in Claude to sign in" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          "Cache-Control": "no-store",
        },
      },
    );
  }
  // Stateless: a fresh server per request, plain JSON answers, no sessions to lose on restart.
  const server = buildMcpServer(caller, { db: getDb(), baseUrl: base });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // The JSON body is already built; closing frees the server.
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
