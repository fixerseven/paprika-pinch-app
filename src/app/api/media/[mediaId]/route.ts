import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getDb } from "@/lib/db";
import { brandRoot, loadBrandConfig } from "@/lib/brands";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
};

/**
 * Serve one media file, read-only, from inside its own brand's folder.
 * The path comes from the database, never from the URL, and must stay inside
 * the brand's root, so an Andar post can never show a Nest file or vice versa.
 */
export async function GET(req: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const row = getDb()
    .prepare(
      `SELECT m.path, b.slug FROM media m JOIN versions v ON v.id = m.version_id
       JOIN posts p ON p.id = v.post_id JOIN brands b ON b.id = p.brand_id WHERE m.id = ?`,
    )
    .get(Number(mediaId)) as { path: string; slug: string } | undefined;
  if (!row) return new Response("Not found", { status: 404 });

  const brand = loadBrandConfig().find((b) => b.slug === row.slug);
  const root = brand && brandRoot(brand);
  if (!root) return new Response("This brand's folder isn't set up on this machine", { status: 404 });

  const file = path.resolve(root, row.path);
  if (!file.startsWith(root + path.sep)) return new Response("Forbidden", { status: 403 });
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return new Response("Unsupported file type", { status: 415 });

  let stat: fs.Stats;
  try {
    stat = fs.statSync(/*turbopackIgnore: true*/ file);
  } catch {
    return new Response("File not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
  };

  // Range requests, so videos can seek on a phone.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    const stream = Readable.toWeb(fs.createReadStream(/*turbopackIgnore: true*/ file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(/*turbopackIgnore: true*/ file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
