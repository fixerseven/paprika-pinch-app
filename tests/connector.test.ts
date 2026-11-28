import crypto from "node:crypto";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openDb, type DB } from "@/lib/db";
import { loadBrandConfig, syncBrands, type BrandConfig } from "@/lib/brands";
import { submitPost } from "@/lib/maker";
import { buildMcpServer, type Caller } from "@/lib/mcp";
import {
  allowedRedirect,
  authClient,
  exchangeCode,
  issueCode,
  readAuthorize,
  refreshTokens,
  registerClient,
  revokeToken,
  verifyAccess,
} from "@/lib/oauth";

const FIX = path.join(__dirname, "fixtures");
const NOW = new Date("2026-11-16T03:00:00Z");
const root = (b: BrandConfig) => path.join(FIX, b.slug);
let db: DB;
let brands: BrandConfig[];

beforeEach(() => {
  db = openDb(":memory:");
  brands = loadBrandConfig();
  syncBrands(db, brands);
});

const CB = "https://claude.ai/api/mcp/auth_callback";
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
};

function authorize(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CB,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    ...extra,
  });
  return readAuthorize(db, q);
}

function connect() {
  const reg = registerClient(db, { client_name: "Claude", redirect_uris: [CB] }, NOW);
  const client = authClient(db, reg.client_id, null);
  const { verifier, challenge } = pkce();
  const a = authorize(reg.client_id, challenge);
  if (!a.ok) throw new Error("authorize failed");
  const back = new URL(issueCode(db, a.req, "nath", NOW));
  const tokens = exchangeCode(db, { client, code: back.searchParams.get("code")!, redirectUri: CB, verifier }, NOW);
  return { reg, client, tokens, back };
}

describe("OAuth for the Claude connector", () => {
  it("only lets https or local http redirects register", () => {
    expect(allowedRedirect(CB)).toBe(true);
    expect(allowedRedirect("http://localhost:6274/oauth/callback")).toBe(true);
    expect(allowedRedirect("http://evil.example/cb")).toBe(false);
    expect(allowedRedirect("javascript:alert(1)")).toBe(false);
    expect(() => registerClient(db, { redirect_uris: ["http://evil.example/cb"] })).toThrow(/https/);
  });

  it("runs the whole flow: register, consent, code, tokens", () => {
    const { tokens, back } = connect();
    expect(back.origin + back.pathname).toBe(CB);
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(tokens.token_type).toBe("Bearer");
    expect(verifyAccess(db, tokens.access_token, NOW)).toMatchObject({ actor: "nath", app: "Claude" });
    // An hour later the access token is dead.
    expect(verifyAccess(db, tokens.access_token, new Date(NOW.getTime() + 3601_000))).toBeNull();
  });

  it("never redirects to an address the app didn't register", () => {
    const reg = registerClient(db, { redirect_uris: [CB] });
    const r = authorize(reg.client_id, pkce().challenge, { redirect_uri: "https://evil.example/cb" });
    expect(r.ok).toBe(false);
    expect("show" in r && r.show).toMatch(/didn't register/);
    expect(authorize("nope", pkce().challenge)).toMatchObject({ ok: false });
  });

  it("requires PKCE S256", () => {
    const reg = registerClient(db, { redirect_uris: [CB] });
    const r = authorize(reg.client_id, pkce().challenge, { code_challenge_method: "plain" });
    expect(r.ok).toBe(false);
    expect("redirect" in r && r.redirect).toMatch(/error=invalid_request/);
  });

  it("refuses a wrong verifier, and a code used twice", () => {
    const reg = registerClient(db, { redirect_uris: [CB] }, NOW);
    const client = authClient(db, reg.client_id, null);
    const { verifier, challenge } = pkce();
    const a = authorize(reg.client_id, challenge);
    if (!a.ok) throw new Error();
    const code = new URL(issueCode(db, a.req, "nath", NOW)).searchParams.get("code")!;
    expect(() => exchangeCode(db, { client, code, redirectUri: CB, verifier: pkce().verifier }, NOW)).toThrow(/PKCE/);
    // That attempt used the code up.
    expect(() => exchangeCode(db, { client, code, redirectUri: CB, verifier }, NOW)).toThrow(/already used/);
  });

  it("rotates refresh tokens, and a reused one ends the connection", () => {
    const { client, tokens } = connect();
    const t2 = refreshTokens(db, { client, refreshToken: tokens.refresh_token }, NOW);
    expect(verifyAccess(db, tokens.access_token, NOW)).toBeNull();
    expect(verifyAccess(db, t2.access_token, NOW)).not.toBeNull();
    expect(() => refreshTokens(db, { client, refreshToken: tokens.refresh_token }, NOW)).toThrow(/already used/);
    expect(verifyAccess(db, t2.access_token, NOW)).toBeNull();
    expect(() => refreshTokens(db, { client, refreshToken: t2.refresh_token }, NOW)).toThrow();
  });

  it("checks secrets for apps that asked for one, and revokes only its own tokens", () => {
    const reg = registerClient(db, { redirect_uris: [CB], token_endpoint_auth_method: "client_secret_post" });
    expect(reg.client_secret).toBeTruthy();
    expect(() => authClient(db, reg.client_id, "wrong")).toThrow(/secret/);
    expect(authClient(db, reg.client_id, reg.client_secret!).id).toBe(reg.client_id);

    const { reg: other, tokens } = connect();
    revokeToken(db, tokens.access_token, reg.client_id); // someone else's token: ignored
    expect(verifyAccess(db, tokens.access_token, NOW)).not.toBeNull();
    revokeToken(db, tokens.refresh_token, other.client_id);
    expect(verifyAccess(db, tokens.access_token, NOW)).toBeNull();
  });
});

async function mcp(caller: Caller) {
  const server = buildMcpServer(caller, { db, brands, root, baseUrl: "https://pinch.example", now: () => NOW });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new McpClient({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as any;
    return { error: !!r.isError, text: r.content[0].text as string, content: r.content, data: r.isError ? null : JSON.parse(r.content[0].text) };
  };
  return { client, call };
}

const NATH: Caller = { role: "approver", actor: "nath", app: "Claude" };
const post = {
  brand: "andar",
  external_id: "A40",
  date: "2026-11-20",
  time: "12:00",
  title: "Workshop open day",
  caption: "Come see the workshop.",
  media: [{ part: "feed", path: "Posts/Test/feed/a2-21 - feed.png" }],
};

describe("Pinch MCP tools", () => {
  it("makers can send and read posts but never decide", async () => {
    const { client, call } = await mcp({ role: "maker", maker: "ac" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("submit_post");
    expect(names).not.toContain("decide_post");
    const r = await call("submit_post", post);
    expect(r.data).toMatchObject({ created: true, state: "review", link: `https://pinch.example/posts/${r.data.id}` });
    expect((await call("decide_post", { id: r.data.id, action: "drop" })).error).toBe(true);
  });

  it("keeps brands apart", async () => {
    const { call } = await mcp(NATH);
    const r = await call("submit_post", { ...post, brand: "nest" });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/Nest Workspaces post id/);
    const r2 = await call("submit_post", { ...post, media: [{ part: "feed", path: "../nest/Designs/Brand/feed/b05 - feed.png" }] });
    expect(r2.error).toBe(true);
  });

  it("Nath approves the exact version seen, from a Claude chat", async () => {
    const { call } = await mcp(NATH);
    const { data: made } = await call("submit_post", post);
    const queue = (await call("review_queue")).data;
    expect(queue.map((c: any) => c.externalId)).toContain("A40");
    const card = queue.find((c: any) => c.externalId === "A40");

    expect((await call("decide_post", { id: made.id, action: "approve" })).text).toMatch(/version_id/);
    // A new version arrives before the yes: the old yes is refused.
    await call("submit_post", { ...post, caption: "Changed", note: "New caption" });
    expect((await call("decide_post", { id: made.id, action: "approve", version_id: card.versionId })).text).toMatch(/newer version/);

    const full = (await call("get_post", { brand: "andar", external_id: "A40" })).data;
    const ok = await call("decide_post", { id: made.id, action: "approve", version_id: full.version.id });
    expect(ok.data.state).toBe("approved");
    const after = (await call("get_post", { id: made.id })).data;
    expect(after.decisions[0]).toMatchObject({ action: "approve", by: "nath", via: "Claude" });
  });

  it("sends back with a note, and lists it", async () => {
    const { call } = await mcp(NATH);
    const { data: made } = await call("submit_post", post);
    expect((await call("decide_post", { id: made.id, action: "send_back" })).error).toBe(true);
    await call("decide_post", { id: made.id, action: "send_back", note: "Use the Saturday photo" });
    const back = (await call("list_sent_back", { brand: "andar" })).data;
    expect(back[0]).toMatchObject({ externalId: "A40", comment: "Use the Saturday photo" });
  });

  it("lists the calendar and shows images from the brand's own folder", async () => {
    const { call } = await mcp(NATH);
    await call("submit_post", post);
    const cal = (await call("list_posts", { from: "2026-11-20", days: 1, brand: "andar" })).data;
    const slot = cal.days[0].brands[0].slots.find((s: any) => s.time === "12:00");
    expect(slot.posts[0]).toMatchObject({ externalId: "A40", state: "review" });
    const r = await call("get_post", { brand: "andar", external_id: "A40", include_images: true });
    expect(r.content.some((c: any) => c.type === "image" && c.mimeType === "image/png")).toBe(true);
    expect((await call("list_brands")).data.map((b: any) => b.brand)).toEqual(["andar", "nest"]);
  });
});
