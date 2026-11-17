import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getPost } from "@/lib/queries";
import { PLATFORM_SHORT, STATE_LABEL, formatDay, formatWhen } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getPost(getDb(), Number(id));
  if (!data) notFound();
  const { post, version, media, versions, channels, decisions, jobs } = data;
  const d = formatDay(post.local_date);

  const parts = ["feed", "story", "reel"] as const;

  return (
    <article className="post-page" style={{ "--brand": post.brand_colour } as React.CSSProperties}>
      <Link href={`/calendar?brand=${post.brand_slug}`} className="back">
        ← Calendar
      </Link>

      <header className="post-head">
        <div className="badges">
          <span className="badge-brand">
            <span className="brand-dot" aria-hidden />
            {post.brand_name}
          </span>
          {[...new Set(channels.map((c: any) => c.platform))].map((p: any) => (
            <span key={p} className="badge">
              {PLATFORM_SHORT[p] ?? p}
            </span>
          ))}
          <span className={`pill st-${post.state}`}>{STATE_LABEL[post.state as keyof typeof STATE_LABEL]}</span>
        </div>
        <h1>
          <span className="post-id">{post.external_id}</span> {post.title}
        </h1>
        <p className="sub">
          {d.weekday} {d.day} {d.month}, {post.local_time} Manila
          {post.track && <> · {post.track}</>}
          {post.owner && <> · from {post.owner}</>}
        </p>
        {post.state_reason && <p className="reason">{post.state_reason}</p>}
      </header>

      {post.flags.length > 0 && (
        <ul className="flag-list">
          {post.flags.map((f: { code: string; text: string }, i: number) => (
            <li key={i} className={`flag flag-${f.code}`}>
              {f.text}
            </li>
          ))}
        </ul>
      )}

      {parts.map((part) => {
        const items = media.filter((m: any) => m.part === part);
        if (!items.length) return null;
        const to = channels.filter((c: any) => c.part === part).map((c: any) => PLATFORM_SHORT[c.platform]);
        return (
          <section key={part} className="part">
            <h2>
              {part === "feed" && items.length > 1 ? `Carousel, ${items.length} slides` : part[0].toUpperCase() + part.slice(1)}
              {to.length > 0 && <span className="to"> → {to.join(", ")}</span>}
            </h2>
            <div className={`media media-${part}`}>
              {items.map((m: any) =>
                m.kind === "video" ? (
                  <video key={m.id} src={`/api/media/${m.id}`} controls playsInline preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={m.id} src={`/api/media/${m.id}`} alt={`${part} ${m.position}`} loading="lazy" />
                ),
              )}
            </div>
          </section>
        );
      })}

      <section className="part">
        <h2>Caption{version && versions.length > 1 && <span className="to"> · version {version.number}</span>}</h2>
        {version?.caption ? <pre className="caption">{version.caption}</pre> : <p className="muted">No caption.</p>}
        {version?.caption_ref && <p className="muted small">From {version.caption_ref}</p>}
      </section>

      {post.notes && (
        <section className="part">
          <h2>Notes from the queue</h2>
          <p>{post.notes}</p>
        </section>
      )}

      {jobs.length > 0 && (
        <section className="part">
          <h2>In Postiz</h2>
          <ul className="plain">
            {jobs.map((j: any) => (
              <li key={j.id}>
                {j.part}: {j.status}
                {j.publish_at && <> for {formatWhen(j.publish_at)}</>}
                <span className="muted small"> · {j.postiz_post_id}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Recorded by the old pipeline. Pinch doesn't change Postiz yet.</p>
        </section>
      )}

      <section className="part">
        <h2>History</h2>
        <ul className="plain">
          {decisions.map((x: any) => (
            <li key={x.id}>
              {formatWhen(x.created_at)} · {x.actor}: {x.action}
              {x.comment && <> · {x.comment}</>}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
