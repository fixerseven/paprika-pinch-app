import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readMaker } from "@/lib/auth";
import { brandRoot, loadBrandConfig } from "@/lib/brands";
import { MakerError, submitPost } from "@/lib/maker";
import { listRevisions } from "@/lib/review";

export const dynamic = "force-dynamic";

/** Makers send a new post, or a new version of one. It always lands in "To review". */
export async function POST(req: Request) {
  const auth = readMaker(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  try {
    const r = submitPost(getDb(), loadBrandConfig(), body, { maker: auth.maker, root: brandRoot });
    return NextResponse.json(r, { status: r.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof MakerError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Makers read what was sent back to them: GET /api/posts?state=revise&brand=andar */
export async function GET(req: Request) {
  const auth = readMaker(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "revise";
  if (state !== "revise") return NextResponse.json({ error: "Only state=revise is supported for now" }, { status: 400 });
  return NextResponse.json({ posts: listRevisions(getDb(), { brand: url.searchParams.get("brand") ?? undefined }) });
}
