import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  wrong: "That passcode isn't right.",
  locked: "Too many tries. Wait five minutes.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = "/", error } = await searchParams;
  if (!authEnabled()) redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  return (
    <form className="login" method="post" action="/api/login">
      <h1>Pinch</h1>
      <p className="sub">Enter your passcode.</p>
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
      {error && ERRORS[error] && <p className="err">{ERRORS[error]}</p>}
      <button type="submit" className="pri">
        Sign in
      </button>
    </form>
  );
}
