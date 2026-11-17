import Link from "next/link";
import { getDb } from "@/lib/db";
import { listRevisions } from "@/lib/review";
import { requireApprover } from "@/lib/session";
import { formatDay, formatWhen } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function RevisionsPage() {
  await requireApprover("/revisions");
  const rows = listRevisions(getDb());
  return (
    <div className="revisions">
      <h1>Sent back</h1>
      <p className="sub">Posts waiting on a maker. They come back to Review when a new version arrives.</p>
      {rows.length === 0 ? (
        <p className="stack-empty">Nothing sent back.</p>
      ) : (
        <ul className="rev-list">
          {rows.map((r) => {
            const d = formatDay(r.localDate);
            return (
              <li key={r.id}>
                <Link href={`/posts/${r.id}`}>
                  <span className="post-id">{r.externalId}</span> {r.title}
                </Link>
                <p className="sub">
                  {r.brandName} · {d.weekday} {d.day} {d.month}, {r.localTime}
                  {r.owner && <> · {r.owner}</>}
                  {r.versionNumber && <> · v{r.versionNumber}</>}
                </p>
                {r.comment && (
                  <blockquote>
                    {r.comment}
                    {r.at && (
                      <cite>
                        {r.by}, {formatWhen(r.at)}
                      </cite>
                    )}
                  </blockquote>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
