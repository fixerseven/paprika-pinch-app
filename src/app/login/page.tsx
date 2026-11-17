import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  wrong: "That passcode isn't right.",
  locked: "Too many tries. Wait five minutes.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = "/review", error } = await searchParams;
  if (!authEnabled()) redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/review");
  return (
    <form className="login" method="post" action="/api/login">
      <h1>Sign in</h1>
      <p className="sub">Enter your Pinch passcode.</p>
      <input type="hidden" name="next" value={next} />
      <input
        name="passcode"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        autoFocus
        required
        aria-label="Passcode"
      />
      {error && ERRORS[error] && <p className="login-error">{ERRORS[error]}</p>}
      <button type="submit">Sign in</button>
    </form>
  );
}
