import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readMaker } from "@/lib/auth";
import { getPost } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** One post with its current version, history and decisions (for makers). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = readMaker(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const data = getPost(getDb(), Number(id));
  if (!data) return NextResponse.json({ error: "No such post" }, { status: 404 });
  const { post, version, media, versions, channels, decisions } = data;
  return NextResponse.json({
    id: post.id,
    brand: post.brand_slug,
    externalId: post.external_id,
    date: post.local_date,
    time: post.local_time,
    title: post.title,
    state: post.state,
    stateReason: post.state_reason,
    flags: post.flags,
    version: version && { number: version.number, caption: version.caption, createdBy: version.created_by },
    media: media.map((m: any) => ({ part: m.part, position: m.position, path: m.path })),
    channels,
    versions,
    decisions: decisions
      .filter((d: any) => !d.undone_at && d.action !== "undo")
      .map((d: any) => ({ action: d.action, comment: d.comment, by: d.actor, at: d.created_at })),
  });
}
