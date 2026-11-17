import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, readSession } from "./auth";

/** The signed-in approver, or null. */
export async function currentApprover(): Promise<string | null> {
  return readSession((await cookies()).get(COOKIE)?.value);
}

/** For pages: send anyone not signed in to the login screen. */
export async function requireApprover(next: string): Promise<string> {
  const who = await currentApprover();
  if (!who) redirect(`/login?next=${encodeURIComponent(next)}`);
  return who;
}
