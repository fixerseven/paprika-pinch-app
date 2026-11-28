import { getDb } from "@/lib/db";
import { readAuthorize } from "@/lib/oauth";
import { requireApprover } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Consent screen for connecting a Claude chat. Only a signed-in approver
 * gets here (the login page brings them back), so only Nath can connect.
 */
export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") q.set(k, v);
  await requireApprover(`/oauth/authorize?${q.toString()}`);

  const r = readAuthorize(getDb(), q);
  if (!r.ok && "redirect" in r) redirect(r.redirect);
  if (!r.ok) {
    return (
      <div className="login">
        <h1>Can&apos;t connect</h1>
        <p className="sub">{r.show}</p>
      </div>
    );
  }
  const back = new URL(r.req.redirectUri);

  return (
    <form className="login" method="post" action="/api/oauth/authorize">
      <h1>Connect {r.req.client.name} to Pinch?</h1>
      <p className="sub">
        {r.req.client.name} will be able to read every brand&apos;s posts, send posts to your Review stack, and approve, drop or
        send back posts when you tell it to. It can&apos;t schedule or publish anything: that still needs your day-of confirm here.
      </p>
      <p className="sub">
        You&apos;ll go back to <strong>{back.host}</strong>.
      </p>
      {[...q.entries()].map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" name="decision" value="allow">
        Allow
      </button>
      <button type="submit" name="decision" value="deny" style={{ background: "transparent", color: "inherit", marginTop: 8 }}>
        Not now
      </button>
    </form>
  );
}
