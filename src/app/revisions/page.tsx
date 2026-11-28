import Link from "next/link";
import { getDb } from "@/lib/db";
import { listBrands } from "@/lib/queries";
import { listRevisions } from "@/lib/review";
import { requireApprover } from "@/lib/session";
import { formatWhen, shortDay } from "@/lib/labels";
import Icon from "../ui/Icon";

export const dynamic = "force-dynamic";

export default async function RevisionsPage() {
  await requireApprover("/revisions");
  const db = getDb();
  const colour = new Map(listBrands(db).map((b) => [b.slug, b.colour]));
  const rows = listRevisions(db);
  return (
    <div className="page">
      <Link href="/" className="back" style={{ marginLeft: 16 }}>
        <Icon name="back" />
        Inbox
      </Link>
      <header className="page-head">
        <h1>With makers</h1>
        <p className="sub">They come back to review when a new version arrives.</p>
      </header>
      {rows.length === 0 ? (
        <p className="none" style={{ marginTop: 20 }}>
          Nothing sent back.
        </p>
      ) : (
        <ul className="rows" style={{ marginTop: 16 }}>
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/posts/${r.id}`} className="row" style={{ "--brand": colour.get(r.brandSlug) } as React.CSSProperties}>
                <span className="mid">
                  <span className="t">{r.title}</span>
                  <span className="s num">
                    <span className="bd" aria-hidden />
                    {r.brandName} · {shortDay(r.localDate)}, {r.localTime}
                    {r.owner && <> · {r.owner}</>}
                  </span>
                  {r.comment && (
                    <span className="note" style={{ display: "block" }}>
                      “{r.comment}”{r.at && <span className="muted"> {formatWhen(r.at)}</span>}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
