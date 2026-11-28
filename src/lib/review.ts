import type { DB } from "./db";
import type { Flag, Part, PostState } from "./import/queue";

export type ReviewAction = "approve" | "reject" | "revise" | "undo";

/** How long after a decision its maker can still take it back. The UI offers 10s; the server allows a little slack. */
export const UNDO_WINDOW_MS = 20_000;

export class DecisionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** States a reviewer may act on. Scheduled and published posts are already in Postiz, so they are out of reach here. */
const FROM: Record<Exclude<ReviewAction, "undo">, PostState[]> = {
  approve: ["review", "approved", "held"],
  reject: ["review", "approved", "held", "revise"],
  revise: ["review", "approved", "held"],
};

const TO: Record<Exclude<ReviewAction, "undo">, PostState> = {
  approve: "approved",
  reject: "rejected",
  revise: "revise",
};

export interface DecideResult {
  postId: number;
  state: PostState;
  decisionId: number;
}

/**
 * Record a reviewer's decision on a post and move it to its new state.
 *
 * An approval is only accepted for the version the reviewer actually saw:
 * if a maker sent a new version in the meantime, the approval is refused.
 */
export function decide(
  db: DB,
  postId: number,
  action: ReviewAction,
  opts: { actor: string; versionId?: number | null; comment?: string | null; via?: string | null; now?: Date },
): DecideResult {
  const now = (opts.now ?? new Date()).toISOString();
  const comment = opts.comment?.trim() || null;

  return db.transaction((): DecideResult => {
    const post = db.prepare("SELECT id, state, state_reason, current_version_id FROM posts WHERE id = ?").get(postId) as
      | { id: number; state: PostState; state_reason: string | null; current_version_id: number | null }
      | undefined;
    if (!post) throw new DecisionError("No such post", 404);

    if (action === "undo") {
      const last = db
        .prepare(
          `SELECT * FROM decisions WHERE post_id = ? AND actor <> 'import' AND undone_at IS NULL
           ORDER BY id DESC LIMIT 1`,
        )
        .get(postId) as any;
      if (!last || last.action === "undo") throw new DecisionError("Nothing to undo", 409);
      if (last.actor !== opts.actor) throw new DecisionError("Only the person who decided can undo it", 403);
      if (Date.parse(now) - Date.parse(last.created_at) > UNDO_WINDOW_MS)
        throw new DecisionError("Too late to undo; open the post to change it", 409);
      if (last.prev_state == null) throw new DecisionError("This decision can't be undone", 409);
      db.prepare("UPDATE decisions SET undone_at = ? WHERE id = ?").run(now, last.id);
      db.prepare("UPDATE posts SET state = ?, state_reason = ?, updated_at = ? WHERE id = ?").run(
        last.prev_state,
        last.prev_reason,
        now,
        postId,
      );
      const { id } = db
        .prepare(
          `INSERT INTO decisions (post_id, version_id, action, comment, actor, created_at, prev_state, prev_reason, via)
           VALUES (?, ?, 'undo', ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(postId, last.version_id, `Undid ${last.action}`, opts.actor, now, post.state, post.state_reason, opts.via ?? null) as {
        id: number;
      };
      return { postId, state: last.prev_state, decisionId: id };
    }

    if (!FROM[action].includes(post.state)) {
      throw new DecisionError(`Can't ${action} a post that is ${post.state}`, 409);
    }
    if (opts.versionId != null && opts.versionId !== post.current_version_id) {
      throw new DecisionError("A newer version arrived while you were looking; check it first", 409);
    }
    if (action === "approve" && opts.versionId == null) {
      throw new DecisionError("Say which version you're approving", 400);
    }
    if (action === "revise" && !comment) throw new DecisionError("Say what needs to change", 400);

    const to = TO[action];
    const reason =
      action === "approve" ? `Approved by ${opts.actor}` : action === "reject" ? comment ?? `Dropped by ${opts.actor}` : comment;
    db.prepare("UPDATE posts SET state = ?, state_reason = ?, updated_at = ? WHERE id = ?").run(to, reason, now, postId);
    const { id } = db
      .prepare(
        `INSERT INTO decisions (post_id, version_id, action, comment, actor, created_at, prev_state, prev_reason, via)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(postId, post.current_version_id, action, comment, opts.actor, now, post.state, post.state_reason, opts.via ?? null) as {
      id: number;
    };
    return { postId, state: to, decisionId: id };
  })();
}

/** True when a person (not the importer) approved this exact version and hasn't undone it. */
export function hasYes(db: DB, postId: number, versionId: number | null): boolean {
  if (versionId == null) return false;
  return !!db
    .prepare(
      `SELECT 1 FROM decisions WHERE post_id = ? AND version_id = ? AND action = 'approve'
       AND actor <> 'import' AND undone_at IS NULL LIMIT 1`,
    )
    .get(postId, versionId);
}

export interface ReviewCard {
  id: number;
  brandSlug: string;
  brandName: string;
  brandColour: string;
  externalId: string;
  title: string;
  localDate: string;
  localTime: string;
  scheduledAt: string;
  state: PostState;
  stateReason: string | null;
  flags: Flag[];
  versionId: number | null;
  versionNumber: number | null;
  caption: string | null;
  media: { id: number; part: Part; position: number; kind: "image" | "video" }[];
  channels: { platform: string; part: Part }[];
  /** Approved by the old queue, but nobody has said yes in Pinch. */
  needsYes: boolean;
  missed: boolean;
}

/**
 * The Review stack: everything waiting on a person, soonest first.
 *  - posts in review (new from a maker, or changed after a decision);
 *  - posts the old queue marked ready that nobody has approved in Pinch, while their slot is still ahead;
 *  - optionally, posts on hold.
 */
export function getReviewStack(db: DB, opts: { brand?: string; includeHeld?: boolean; now?: Date } = {}): ReviewCard[] {
  const now = (opts.now ?? new Date()).toISOString();
  const rows = db
    .prepare(
      `SELECT p.*, b.slug AS brand_slug, b.name AS brand_name, b.colour AS brand_colour,
              v.number AS version_number, v.caption
       FROM posts p JOIN brands b ON b.id = p.brand_id
       LEFT JOIN versions v ON v.id = p.current_version_id
       WHERE (@brand IS NULL OR b.slug = @brand)
         AND (
           p.state = 'review'
           OR (p.state = 'approved' AND p.scheduled_at >= @now AND NOT EXISTS (
                 SELECT 1 FROM decisions d WHERE d.post_id = p.id AND d.version_id = p.current_version_id
                 AND d.action = 'approve' AND d.actor <> 'import' AND d.undone_at IS NULL))
           OR (@held = 1 AND p.state = 'held')
         )
       ORDER BY p.scheduled_at, b.id, p.external_id`,
    )
    .all({ brand: opts.brand ?? null, now, held: opts.includeHeld ? 1 : 0 }) as any[];

  const mediaQ = db.prepare(
    `SELECT id, part, position, kind FROM media WHERE version_id = ?
     ORDER BY CASE part WHEN 'feed' THEN 0 WHEN 'reel' THEN 1 ELSE 2 END, position`,
  );
  const chanQ = db.prepare(
    `SELECT c.platform, pc.part FROM post_channels pc JOIN channels c ON c.id = pc.channel_id
     WHERE pc.post_id = ? ORDER BY c.platform`,
  );

  return rows.map((r) => ({
    id: r.id,
    brandSlug: r.brand_slug,
    brandName: r.brand_name,
    brandColour: r.brand_colour,
    externalId: r.external_id,
    title: r.title,
    localDate: r.local_date,
    localTime: r.local_time,
    scheduledAt: r.scheduled_at,
    state: r.state,
    stateReason: r.state_reason,
    flags: JSON.parse(r.flags),
    versionId: r.current_version_id,
    versionNumber: r.version_number ?? null,
    caption: r.caption ?? null,
    media: r.current_version_id ? (mediaQ.all(r.current_version_id) as any[]) : [],
    channels: chanQ.all(r.id) as any[],
    needsYes: r.state === "approved",
    missed: r.scheduled_at < now,
  }));
}

export interface RevisionNote {
  id: number;
  brandSlug: string;
  brandName: string;
  externalId: string;
  title: string;
  localDate: string;
  localTime: string;
  owner: string | null;
  versionNumber: number | null;
  comment: string | null;
  by: string | null;
  at: string | null;
}

/** Posts sent back for changes, with the latest note on each. */
export function listRevisions(db: DB, opts: { brand?: string } = {}): RevisionNote[] {
  return db
    .prepare(
      `SELECT p.id, b.slug AS brandSlug, b.name AS brandName, p.external_id AS externalId, p.title,
              p.local_date AS localDate, p.local_time AS localTime, p.owner, v.number AS versionNumber,
              d.comment, d.actor AS by, d.created_at AS at
       FROM posts p JOIN brands b ON b.id = p.brand_id
       LEFT JOIN versions v ON v.id = p.current_version_id
       LEFT JOIN decisions d ON d.id = (
         SELECT id FROM decisions WHERE post_id = p.id AND action = 'revise' AND undone_at IS NULL
         ORDER BY id DESC LIMIT 1)
       WHERE p.state = 'revise' AND (@brand IS NULL OR b.slug = @brand)
       ORDER BY p.scheduled_at`,
    )
    .all({ brand: opts.brand ?? null }) as RevisionNote[];
}
