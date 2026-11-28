import crypto from "node:crypto";
import type { DB } from "./db";

/**
 * OAuth 2.1 for the Claude connector.
 *
 * Claude (claude.ai, the desktop and mobile apps, Claude Code) registers
 * itself (dynamic client registration), sends Nath to the consent screen,
 * and swaps the one-time code for tokens with PKCE. Only a signed-in
 * approver can reach the consent screen, so only Nath can connect a chat.
 *
 * Codes and tokens are random and stored only as SHA-256 hashes.
 * Access tokens last an hour; refresh tokens rotate on every use, and
 * reusing an old one ends the whole connection.
 */

export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 90 * 86400;
const CODE_TTL_S = 5 * 60;

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const random = (prefix: string) => prefix + crypto.randomBytes(32).toString("base64url");
const iso = (d: Date) => d.toISOString();
const plus = (now: Date, s: number) => iso(new Date(now.getTime() + s * 1000));

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** https anywhere, or http only back to this computer (Claude Code's local callback). */
export function allowedRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

export interface Client {
  id: string;
  name: string;
  redirectUris: string[];
  hasSecret: boolean;
}

export function getClient(db: DB, id: string | null | undefined): Client | undefined {
  if (!id) return undefined;
  const r = db.prepare("SELECT * FROM oauth_clients WHERE id = ?").get(id) as any;
  return r && { id: r.id, name: r.name, redirectUris: JSON.parse(r.redirect_uris), hasSecret: !!r.secret_hash };
}

/** RFC 7591 dynamic client registration. */
export function registerClient(db: DB, raw: unknown, now = new Date()) {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || uris.some((u) => typeof u !== "string" || u.length > 500))
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must be a list of up to 10 URLs");
  if (!uris.every((u) => allowedRedirect(u as string)))
    throw new OAuthError("invalid_redirect_uri", "Redirect URLs must be https, or http on localhost");
  const name = (typeof body.client_name === "string" ? body.client_name : "Claude").replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 60) || "Claude";
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method))
    throw new OAuthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method");

  const id = random("pinch_client_");
  const secret = method === "none" ? null : random("pinch_secret_");
  db.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    name,
    JSON.stringify(uris),
    secret ? hash(secret) : null,
    iso(now),
  );
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
  };
}

export interface AuthorizeRequest {
  client: Client;
  redirectUri: string;
  challenge: string;
  state: string | null;
  resource: string | null;
  scope: string | null;
}

/**
 * Check the query of /oauth/authorize. Problems with the client or redirect
 * are shown on screen (never redirect to an unknown URL); others go back to
 * the client as an OAuth error.
 */
export function readAuthorize(
  db: DB,
  q: URLSearchParams,
): { ok: true; req: AuthorizeRequest } | { ok: false; show: string } | { ok: false; redirect: string } {
  const client = getClient(db, q.get("client_id"));
  if (!client) return { ok: false, show: "This app isn't registered with Pinch. Remove the connector in Claude and add it again." };
  const redirectUri = q.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, show: "The app asked to return to an address it didn't register." };
  const state = q.get("state");
  const fail = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (state) u.searchParams.set("state", state);
    return { ok: false as const, redirect: u.toString() };
  };
  if (q.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  const challenge = q.get("code_challenge") ?? "";
  if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge))
    return fail("invalid_request", "PKCE with S256 is required");
  return {
    ok: true,
    req: { client, redirectUri, challenge, state, resource: q.get("resource"), scope: q.get("scope") },
  };
}

/** Nath said yes on the consent screen: make a one-time code and the URL to send the browser back to. */
export function issueCode(db: DB, req: AuthorizeRequest, actor: string, now = new Date()): string {
  const code = random("pinch_code_");
  db.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, challenge, actor, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(hash(code), req.client.id, req.redirectUri, req.challenge, actor, req.resource, plus(now, CODE_TTL_S));
  const u = new URL(req.redirectUri);
  u.searchParams.set("code", code);
  if (req.state) u.searchParams.set("state", req.state);
  return u.toString();
}

export function denyUrl(req: AuthorizeRequest): string {
  const u = new URL(req.redirectUri);
  u.searchParams.set("error", "access_denied");
  u.searchParams.set("error_description", "Nath said no");
  if (req.state) u.searchParams.set("state", req.state);
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function mintTokens(db: DB, grantId: number, now: Date): TokenResponse {
  const access = random("pinch_at_");
  const refresh = random("pinch_rt_");
  const ins = db.prepare("INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)");
  ins.run(hash(access), grantId, "access", plus(now, ACCESS_TTL_S));
  ins.run(hash(refresh), grantId, "refresh", plus(now, REFRESH_TTL_S));
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: "pinch" };
}

/** Check the client at the token endpoint. Public clients just name themselves; others must show their secret. */
export function authClient(db: DB, clientId: string | null, secret: string | null): Client {
  const client = getClient(db, clientId);
  if (!client) throw new OAuthError("invalid_client", "Unknown client", 401);
  if (client.hasSecret) {
    const row = db.prepare("SELECT secret_hash FROM oauth_clients WHERE id = ?").get(client.id) as { secret_hash: string };
    if (!secret || !sameHash(hash(secret), row.secret_hash)) throw new OAuthError("invalid_client", "Bad client secret", 401);
  }
  return client;
}

const verifierOk = (verifier: string, challenge: string) =>
  /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) &&
  sameHash(crypto.createHash("sha256").update(verifier).digest("base64url"), challenge);

export function exchangeCode(
  db: DB,
  p: { client: Client; code: string; redirectUri: string | null; verifier: string },
  now = new Date(),
): TokenResponse {
  // Errors are returned, not thrown, so the revocations below commit.
  const r = db.transaction((): TokenResponse | OAuthError => {
    const row = db.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").get(hash(p.code)) as any;
    if (!row || row.client_id !== p.client.id) return new OAuthError("invalid_grant", "Unknown code");
    if (row.used_at) {
      // A code used twice may have been stolen: end anything it produced.
      db.prepare(
        "UPDATE oauth_grants SET revoked_at = ? WHERE client_id = ? AND created_at >= ? AND revoked_at IS NULL",
      ).run(iso(now), row.client_id, row.used_at);
      return new OAuthError("invalid_grant", "Code already used");
    }
    db.prepare("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ?").run(iso(now), row.code_hash);
    if (row.expires_at < iso(now)) return new OAuthError("invalid_grant", "Code expired");
    if (p.redirectUri != null && p.redirectUri !== row.redirect_uri) return new OAuthError("invalid_grant", "redirect_uri doesn't match");
    if (!verifierOk(p.verifier, row.challenge)) return new OAuthError("invalid_grant", "PKCE check failed");
    const { id } = db
      .prepare("INSERT INTO oauth_grants (client_id, actor, created_at, last_used_at) VALUES (?, ?, ?, ?) RETURNING id")
      .get(p.client.id, row.actor, iso(now), iso(now)) as { id: number };
    return mintTokens(db, id, now);
  })();
  if (r instanceof OAuthError) throw r;
  return r;
}

export function refreshTokens(db: DB, p: { client: Client; refreshToken: string }, now = new Date()): TokenResponse {
  const r = db.transaction((): TokenResponse | OAuthError => {
    const row = db
      .prepare(
        `SELECT t.*, g.client_id, g.revoked_at FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
         WHERE t.token_hash = ? AND t.kind = 'refresh'`,
      )
      .get(hash(p.refreshToken)) as any;
    if (!row || row.client_id !== p.client.id || row.revoked_at) return new OAuthError("invalid_grant", "Unknown refresh token");
    if (row.used_at) {
      // Reuse of a rotated refresh token: someone else may hold it. End the connection.
      db.prepare("UPDATE oauth_grants SET revoked_at = ? WHERE id = ?").run(iso(now), row.grant_id);
      return new OAuthError("invalid_grant", "Refresh token already used; connect again");
    }
    if (row.expires_at < iso(now)) return new OAuthError("invalid_grant", "Refresh token expired; connect again");
    db.prepare("UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ?").run(iso(now), row.token_hash);
    db.prepare("DELETE FROM oauth_tokens WHERE grant_id = ? AND kind = 'access'").run(row.grant_id);
    db.prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?").run(iso(now), row.grant_id);
    return mintTokens(db, row.grant_id, now);
  })();
  if (r instanceof OAuthError) throw r;
  return r;
}

export interface Caller {
  actor: string;
  app: string;
  grantId: number;
}

/** Who is behind an access token, or null if it's unknown, expired or revoked. */
export function verifyAccess(db: DB, token: string, now = new Date()): Caller | null {
  if (!token.startsWith("pinch_at_")) return null;
  const row = db
    .prepare(
      `SELECT t.expires_at, g.id AS grant_id, g.actor, g.revoked_at, c.name AS app
       FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN oauth_clients c ON c.id = g.client_id
       WHERE t.token_hash = ? AND t.kind = 'access'`,
    )
    .get(hash(token)) as any;
  if (!row || row.revoked_at || row.expires_at < iso(now)) return null;
  return { actor: row.actor, app: row.app, grantId: row.grant_id };
}

/** RFC 7009: revoke a token (and its whole connection). Unknown tokens are fine. */
export function revokeToken(db: DB, token: string, clientId: string, now = new Date()): void {
  const row = db
    .prepare("SELECT t.grant_id, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = ?")
    .get(hash(token)) as any;
  if (row && row.client_id === clientId) revokeGrant(db, row.grant_id, now);
}

export function revokeGrant(db: DB, grantId: number, now = new Date()): boolean {
  db.prepare("DELETE FROM oauth_tokens WHERE grant_id = ?").run(grantId);
  return db.prepare("UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(iso(now), grantId).changes > 0;
}

export function listGrants(db: DB) {
  return db
    .prepare(
      `SELECT g.id, c.name AS app, g.actor, g.created_at AS connectedAt, g.last_used_at AS lastUsedAt, g.revoked_at AS revokedAt
       FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id ORDER BY g.id DESC`,
    )
    .all() as { id: number; app: string; actor: string; connectedAt: string; lastUsedAt: string | null; revokedAt: string | null }[];
}

/** Note that a connection was used, at most once a minute. */
export function touchGrant(db: DB, grantId: number, now = new Date()): void {
  db.prepare(
    "UPDATE oauth_grants SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)",
  ).run(iso(now), grantId, iso(new Date(now.getTime() - 60_000)));
}
