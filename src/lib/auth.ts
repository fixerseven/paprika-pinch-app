import crypto from "node:crypto";

/**
 * Approver sign-in.
 *
 * PINCH_PASSCODE is the approver's passcode and PINCH_SECRET signs the cookie.
 * With no passcode set (local development), everyone is the dev approver.
 * Makers use a separate bearer token, PINCH_MAKER_TOKEN, and can never decide.
 */
export const COOKIE = "pinch_session";
const DAYS = 30;

export function authEnabled(): boolean {
  return !!process.env.PINCH_PASSCODE;
}

export function approverName(): string {
  return process.env.PINCH_APPROVER_NAME || "nath";
}

function secret(): string {
  const s = process.env.PINCH_SECRET;
  if (!s || s.length < 16) throw new Error("PINCH_SECRET must be set (16+ characters) when PINCH_PASSCODE is set");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkPasscode(given: string): boolean {
  const want = process.env.PINCH_PASSCODE ?? "";
  if (!want) return false;
  const h = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(given), h(want));
}

export function makeSession(name: string, now = Date.now()): { value: string; maxAge: number } {
  const exp = Math.floor(now / 1000) + DAYS * 86400;
  const payload = `${name}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: DAYS * 86400 };
}

/** The approver behind a cookie value, or null if it's missing, forged or expired. */
export function readSession(value: string | undefined, now = Date.now()): string | null {
  if (!authEnabled()) return "dev";
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [name, exp, sig] = parts;
  if (!same(sig, sign(`${name}.${exp}`))) return null;
  if (Number(exp) * 1000 < now) return null;
  return name;
}

/** Name of the maker behind an Authorization header, or null. Makers may say who they are with X-Pinch-Maker. */
export function readMaker(req: Request): { ok: true; maker: string } | { ok: false; status: number; error: string } {
  const token = process.env.PINCH_MAKER_TOKEN;
  if (!token) return { ok: false, status: 503, error: "The maker API is off on this server (PINCH_MAKER_TOKEN isn't set)" };
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!same(crypto.createHash("sha256").update(given).digest("hex"), crypto.createHash("sha256").update(token).digest("hex")))
    return { ok: false, status: 401, error: "Bad or missing maker token" };
  const name = (req.headers.get("x-pinch-maker") ?? "maker").replace(/[^\w .-]/g, "").slice(0, 40) || "maker";
  return { ok: true, maker: name };
}
