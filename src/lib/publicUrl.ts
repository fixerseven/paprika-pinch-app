/**
 * The address people and Claude use to reach Pinch, without a trailing slash.
 *
 * Set PINCH_PUBLIC_URL (e.g. https://pinch.hellopaprika.com). Without it, the
 * proxy's X-Forwarded-* headers are used, then the request itself. Behind
 * a tunnel or `tailscale serve`, req.url is localhost, so don't trust it alone.
 */
export function publicUrl(req?: Request): string {
  const env = process.env.PINCH_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (!req) return "http://localhost:3000";
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || u.host;
  return `${proto}://${host}`;
}
