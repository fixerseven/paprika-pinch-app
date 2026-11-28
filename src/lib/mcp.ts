import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DB } from "./db";
import { brandRoot, loadBrandConfig, type BrandConfig } from "./brands";
import { getCalendar, getPost, listBrands } from "./queries";
import { DecisionError, decide, getReviewStack, listRevisions, type ReviewAction } from "./review";
import { MakerError, submitPost } from "./maker";
import { addDays, todayIn } from "./time";

/**
 * The Pinch connector for Claude: the same rules as the app, as MCP tools.
 *
 * An approver (Nath, signed in through OAuth) can read everything and decide.
 * A maker (the maker token) can read and send posts, never decide.
 * Nothing here can schedule or publish: posting stays behind the day-of confirm.
 */
export type Caller = { role: "approver"; actor: string; app: string } | { role: "maker"; maker: string };

export interface McpDeps {
  db: DB;
  brands?: BrandConfig[];
  root?: (b: BrandConfig) => string | undefined;
  /** Public address of Pinch, for links back to a post. */
  baseUrl?: string;
  now?: () => Date;
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const brandArg = (brands: BrandConfig[]) =>
  z.enum(brands.map((b) => b.slug) as [string, ...string[]]);

export function buildMcpServer(caller: Caller, deps: McpDeps): McpServer {
  const { db } = deps;
  const brands = deps.brands ?? loadBrandConfig();
  const root = deps.root ?? brandRoot;
  const now = deps.now ?? (() => new Date());
  const link = (id: number) => (deps.baseUrl ? `${deps.baseUrl}/posts/${id}` : undefined);
  const tz = brands[0]?.timezone ?? "Asia/Manila";

  const server = new McpServer(
    { name: "pinch", title: "Pinch", version: "1.0.0" },
    {
      instructions:
        "Pinch is Nath's approval station for social posts (brands: " +
        brands.map((b) => `${b.slug} = ${b.name}`).join(", ") +
        "). Times are Manila time. Keep each brand separate: never move captions, files or ids from one brand to another. " +
        "Pinch can't schedule or publish; a post goes out only after Nath approves it and confirms on the day in the Pinch app." +
        (caller.role === "approver"
          ? " Only use decide_post when Nath has clearly told you to in this chat, about a version Nath has seen."
          : ""),
    },
  );

  const findPost = (a: { id?: number; brand?: string; external_id?: string }): number | string => {
    if (a.id != null) return a.id;
    if (!a.brand || !a.external_id) return "Give either id, or brand and external_id";
    const r = db
      .prepare("SELECT p.id FROM posts p JOIN brands b ON b.id = p.brand_id WHERE b.slug = ? AND p.external_id = ?")
      .get(a.brand, a.external_id) as { id: number } | undefined;
    return r ? r.id : `No ${a.brand} post ${a.external_id}`;
  };

  server.registerTool(
    "list_brands",
    {
      title: "List brands",
      description: "The brands and pages Pinch handles, with their usual posting slots (Manila time) and channels.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      json(
        listBrands(db).map((b) => {
          const cfg = brands.find((c) => c.slug === b.slug);
          return {
            brand: b.slug,
            name: b.name,
            timezone: b.timezone,
            slots: b.slots,
            postIdPattern: cfg?.postIdPattern,
            channels: cfg?.channels.filter((c) => c.active !== false).map((c) => ({ platform: c.platform, name: c.name })),
          };
        }),
      ),
  );

  server.registerTool(
    "list_posts",
    {
      title: "List posts",
      description:
        "Posts on the calendar for a date range, by slot: what's planned, approved, scheduled, posted, held or sent back. Empty usual slots are listed too.",
      inputSchema: {
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("First day, YYYY-MM-DD (default today in Manila)"),
        days: z.number().int().min(1).max(31).optional().describe("How many days (default 7)"),
        brand: brandArg(brands).optional(),
        state: z
          .enum(["review", "approved", "held", "revise", "rejected", "scheduled", "published"])
          .optional()
          .describe("Only posts in this state"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const from = a.from ?? todayIn(tz, now());
      const days = getCalendar(db, { from, days: a.days ?? 7, brand: a.brand, now: now() });
      const out = days.map((d) => ({
        date: d.date,
        brands: d.brands.map((b) => ({
          brand: b.brand.slug,
          slots: b.slots
            .map((s) => ({
              time: s.time,
              empty: s.empty,
              posts: s.posts
                .filter((p) => !a.state || p.state === a.state)
                .map((p) => ({
                  id: p.id,
                  externalId: p.externalId,
                  title: p.title,
                  state: p.state,
                  reason: p.stateReason,
                  parts: p.parts,
                  channels: p.channels.map((c) => c.platform),
                  flags: p.flags.map((f) => f.text),
                  missed: p.missed,
                })),
            }))
            .filter((s) => (a.state ? s.posts.length : s.posts.length || (s.empty && s.time))),
        })),
      }));
      return json({ from, to: addDays(from, (a.days ?? 7) - 1), days: out });
    },
  );

  server.registerTool(
    "get_post",
    {
      title: "Get a post",
      description:
        "One post in full: caption, files, channels, flags, every version and decision. Set include_images to see the feed and story images (up to 4).",
      inputSchema: {
        id: z.number().int().optional().describe("Pinch post id"),
        brand: brandArg(brands).optional(),
        external_id: z.string().optional().describe("The brand's own post id, like A40"),
        include_images: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const id = findPost(a);
      if (typeof id === "string") return fail(id);
      const data = getPost(db, id);
      if (!data) return fail("No such post");
      const { post, version, media, versions, channels, decisions } = data;
      const body = {
        id: post.id,
        brand: post.brand_slug,
        externalId: post.external_id,
        title: post.title,
        date: post.local_date,
        time: post.local_time,
        state: post.state,
        reason: post.state_reason,
        owner: post.owner,
        notes: post.notes,
        flags: post.flags.map((f: { text: string }) => f.text),
        version: version && { id: version.id, number: version.number, by: version.created_by, note: version.note, caption: version.caption },
        files: media.map((m: any) => ({ part: m.part, position: m.position, kind: m.kind, path: m.path })),
        channels: channels.map((c: any) => ({ platform: c.platform, name: c.name, part: c.part })),
        versions: versions.map((v: any) => ({ id: v.id, number: v.number, by: v.created_by, note: v.note, at: v.created_at })),
        decisions: decisions.slice(0, 15).map((d: any) => ({
          action: d.action,
          by: d.actor,
          via: d.via ?? undefined,
          comment: d.comment,
          versionId: d.version_id,
          at: d.created_at,
          undone: !!d.undone_at,
        })),
        link: link(post.id),
      };
      const content: any[] = json(body).content;
      if (a.include_images) {
        const cfg = brands.find((b) => b.slug === post.brand_slug);
        const base = cfg && root(cfg);
        const skipped: string[] = [];
        for (const m of media.filter((m: any) => m.kind === "image").slice(0, 4)) {
          const type = IMAGE_TYPES[path.extname(m.path).toLowerCase()];
          const file = base ? path.resolve(base, m.path) : "";
          // Same rule as the media route: only ever read from inside this post's own brand folder.
          if (!base || !type || !file.startsWith(base + path.sep)) {
            skipped.push(m.path);
            continue;
          }
          try {
            const st = fs.statSync(/*turbopackIgnore: true*/ file);
            if (st.size > MAX_IMAGE_BYTES) {
              skipped.push(`${m.path} (too big to show here; open the link)`);
              continue;
            }
            content.push({ type: "image", data: fs.readFileSync(/*turbopackIgnore: true*/ file).toString("base64"), mimeType: type });
          } catch {
            skipped.push(`${m.path} (missing)`);
          }
        }
        if (skipped.length) content.push({ type: "text", text: `Not shown: ${skipped.join(", ")}` });
      }
      return { content };
    },
  );

  server.registerTool(
    "review_queue",
    {
      title: "What needs Nath's yes",
      description:
        "The Review stack, soonest first: new and revised posts from makers, and posts the old queue marked ready that nobody has approved in Pinch yet.",
      inputSchema: { brand: brandArg(brands).optional(), include_held: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      json(
        getReviewStack(db, { brand: a.brand, includeHeld: a.include_held, now: now() }).map((c) => ({
          id: c.id,
          brand: c.brandSlug,
          externalId: c.externalId,
          title: c.title,
          date: c.localDate,
          time: c.localTime,
          state: c.state,
          reason: c.stateReason,
          needsYes: c.needsYes,
          missed: c.missed,
          versionId: c.versionId,
          versionNumber: c.versionNumber,
          caption: c.caption,
          files: c.media.map((m) => `${m.part} ${m.position} (${m.kind})`),
          channels: c.channels.map((x) => `${x.platform} ${x.part}`),
          flags: c.flags.map((f) => f.text),
          link: link(c.id),
        })),
      ),
  );

  server.registerTool(
    "list_sent_back",
    {
      title: "Posts sent back",
      description: "Posts Nath sent back for changes, with the latest note on each.",
      inputSchema: { brand: brandArg(brands).optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => json(listRevisions(db, { brand: a.brand })),
  );

  server.registerTool(
    "submit_post",
    {
      title: "Send a post for review",
      description:
        "Add a new post, or a new version of an existing one (same brand and external_id), to Nath's Review stack. " +
        "It never approves or schedules anything. Files must already be in that brand's own folder; give paths relative to it. " +
        "The id must match the brand's pattern (Andar ids start with A and a digit).",
      inputSchema: {
        brand: brandArg(brands),
        external_id: z.string().max(40),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD, Manila"),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("HH:MM, 24-hour, Manila"),
        title: z.string().max(200),
        caption: z.string().max(5000).optional(),
        media: z
          .array(z.object({ part: z.enum(["feed", "story", "reel"]), path: z.string() }))
          .max(20)
          .optional()
          .describe("Files in the brand folder, in order; carousel slides are several feed files"),
        checks: z.array(z.string()).max(10).optional().describe("Things Nath should check, shown on the card"),
        note: z.string().max(500).optional().describe("For a new version: what changed"),
        notes: z.string().max(2000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (a) => {
      const maker = caller.role === "maker" ? caller.maker : "claude";
      try {
        const r = submitPost(
          db,
          brands,
          {
            brand: a.brand,
            externalId: a.external_id,
            date: a.date,
            time: a.time,
            title: a.title,
            caption: a.caption,
            media: a.media,
            checks: a.checks,
            note: a.note,
            notes: a.notes,
          },
          { maker, root, now: now() },
        );
        return json({ ...r, link: link(r.id) });
      } catch (e) {
        if (e instanceof MakerError) return fail(e.message);
        throw e;
      }
    },
  );

  if (caller.role === "approver") {
    const ACTIONS: Record<string, ReviewAction> = { approve: "approve", drop: "reject", send_back: "revise", undo: "undo" };
    server.registerTool(
      "decide_post",
      {
        title: "Approve, drop or send back a post",
        description:
          "Record Nath's decision on a post. Only call this when Nath has clearly told you to in this chat. " +
          "approve needs the version_id Nath saw (from get_post or review_queue); if a newer version arrived it is refused. " +
          "send_back needs a note saying what to change. undo takes back the last decision within 20 seconds. " +
          "Approving does not post anything: it still needs Nath's day-of confirm in the Pinch app.",
        inputSchema: {
          id: z.number().int(),
          action: z.enum(["approve", "drop", "send_back", "undo"]),
          version_id: z.number().int().optional(),
          note: z.string().max(2000).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      async (a) => {
        if (a.action === "approve" && a.version_id == null) return fail("Say which version Nath is approving (version_id)");
        try {
          const r = decide(db, a.id, ACTIONS[a.action], {
            actor: caller.actor,
            versionId: a.version_id ?? null,
            comment: a.note ?? null,
            via: caller.app,
            now: now(),
          });
          return json({ ...r, link: link(a.id) });
        } catch (e) {
          if (e instanceof DecisionError) return fail(e.message);
          throw e;
        }
      },
    );
  }

  return server;
}
