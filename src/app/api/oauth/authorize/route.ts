import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { COOKIE, readSession } from "@/lib/auth";
import { denyUrl, issueCode, readAuthorize } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const go = (location: string) => new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

/** The consent screen's Allow / Not now. */
export async function POST(req: Request) {
  const form = await req.formData();
  const q = new URLSearchParams();
  for (const [k, v] of form.entries()) if (typeof v === "string" && k !== "decision") q.set(k, v);

  const actor = readSession((await cookies()).get(COOKIE)?.value);
  if (!actor) return go(`/login?next=${encodeURIComponent(`/oauth/authorize?${q.toString()}`)}`);
  // Same-origin only, so another site can't connect itself through a signed-in browser.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || new URL(origin).host !== host) return new Response("Cross-site request refused", { status: 403 });

  const db = getDb();
  const r = readAuthorize(db, q);
  if (!r.ok) return "redirect" in r ? go(r.redirect) : new Response(r.show, { status: 400 });
  if (form.get("decision") !== "allow") return go(denyUrl(r.req));
  return go(issueCode(db, r.req, actor));
}
