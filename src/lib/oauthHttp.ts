/** Reading OAuth requests: form or JSON bodies, and client credentials. */

export async function readForm(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(j).filter(([, v]) => typeof v === "string") as [string, string][]);
  }
  return new URLSearchParams(await req.text());
}

/** Client credentials from HTTP Basic or the form body. */
export function clientCreds(req: Request, form: URLSearchParams): { id: string | null; secret: string | null } {
  const basic = /^Basic (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (basic) {
    const [id, secret] = Buffer.from(basic, "base64").toString().split(":").map(decodeURIComponent);
    return { id: id ?? null, secret: secret ?? null };
  }
  return { id: form.get("client_id"), secret: form.get("client_secret") };
}
