import { NextResponse } from "next/server";
import { COOKIE, approverName, authEnabled, checkPasscode, makeSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { n: number; until: number }>();

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/review";
}

export async function POST(req: Request) {
  const form = await req.formData();
  const next = safeNext(form.get("next"));
  const url = new URL(req.url);
  const back = (err: string) =>
    NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}&error=${err}`, url), 303);

  if (!authEnabled()) return NextResponse.redirect(new URL(next, url), 303);

  // Slow down guessing: five wrong tries locks this client out for five minutes.
  const who = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const a = attempts.get(who);
  if (a && a.until > Date.now()) return back("locked");

  if (!checkPasscode(String(form.get("passcode") ?? ""))) {
    const n = (a && a.until <= Date.now() && a.n >= 5 ? 0 : a?.n ?? 0) + 1;
    attempts.set(who, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return back("wrong");
  }
  attempts.delete(who);
  const s = makeSession(approverName());
  const res = NextResponse.redirect(new URL(next, url), 303);
  res.cookies.set(COOKIE, s.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: s.maxAge,
  });
  return res;
}
