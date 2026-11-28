import type { ChannelIssue } from "@/lib/queries";
import { PLATFORM_SHORT } from "@/lib/labels";

const PLATFORM: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", threads: "Threads", tiktok: "TikTok", linkedin: "LinkedIn", x: "X" };

/** Every broken channel on one red line; tap it for the list. */
export default function ChannelIssues({ issues }: { issues: ChannelIssue[] }) {
  if (!issues.length) return null;
  const one = issues[0];
  const label =
    issues.length === 1
      ? `${one.brandName} can't post to ${PLATFORM[one.platform] ?? one.platform}`
      : `${issues.length} channels can't post`;
  return (
    <details className="alert">
      <summary>
        <i aria-hidden />
        <span>{label}</span>
        <b>Fix</b>
      </summary>
      <ul>
        {issues.map((x) => (
          <li key={x.brandSlug + x.platform}>
            <span>
              {x.brandName} on {PLATFORM_SHORT[x.platform] ?? x.platform}
            </span>
            <span className="num">
              {x.reason === "expired" ? "Login expired" : "Switched off"} · {x.posts} {x.posts === 1 ? "post" : "posts"} coming
            </span>
          </li>
        ))}
        <li className="hint">Reconnect it in Postiz on the Mac mini. Posts still go to their other channels.</li>
      </ul>
    </details>
  );
}
