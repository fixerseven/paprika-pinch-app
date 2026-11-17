import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { COOKIE, readSession } from "@/lib/auth";
import { DecisionError, decide, type ReviewAction } from "@/lib/review";

export const dynamic = "force-dynamic";

const ACTIONS: ReviewAction[] = ["approve", "reject", "revise", "undo"];

/** An approver's decision on one post. Only a signed-in approver can call this; makers can't. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = readSession((await cookies()).get(COOKIE)?.value);
  if (!actor) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  // Same-origin only, so another site can't make a signed-in phone approve something.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });

  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  if (!ACTIONS.includes(body?.action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  try {
    const r = decide(getDb(), Number(id), body.action, {
      actor,
      versionId: typeof body.versionId === "number" ? body.versionId : null,
      comment: typeof body.comment === "string" ? body.comment.slice(0, 2000) : null,
    });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof DecisionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
