import { publicUrl } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";

/** RFC 9728: tells Claude that /mcp is protected and where to sign in. */
export function GET(req: Request) {
  const base = publicUrl(req);
  return Response.json(
    {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      scopes_supported: ["pinch"],
      resource_name: "Pinch",
    },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
