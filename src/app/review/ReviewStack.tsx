"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewCard } from "@/lib/review";
import { PLATFORM_SHORT, loudFlags, shortDay } from "@/lib/labels";
import Icon from "../ui/Icon";

type Act = "approve" | "reject" | "revise";
const LABEL: Record<Act, string> = { approve: "Approved", reject: "Dropped", revise: "Sent back" };
const THRESHOLD = 90;
const QUICK = ["Fix the caption", "Swap the photo", "Check the facts", "Wrong day"];
const PART: Record<string, string> = { feed: "Feed", story: "Story", reel: "Reel" };

async function send(id: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/posts/${id}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  return data;
}

/**
 * One post per screen. Approve is the only filled button; Send back sits beside it;
 * Later and Drop live behind the ··· menu. Swipe right approves, swipe left opens
 * Send back (so a slip never drops a post). Keys: → approve, ← send back, L later, U undo.
 */
export default function ReviewStack({ initial, today }: { initial: ReviewCard[]; today: string }) {
  const [cards, setCards] = useState(initial);
  const [total] = useState(initial.length);
  const [slide, setSlide] = useState(0);
  const [details, setDetails] = useState(false);
  const [drag, setDrag] = useState({ x: 0, active: false });
  const [leaving, setLeaving] = useState<Act | null>(null);
  const [entering, setEntering] = useState(false);
  const [sheet, setSheet] = useState<"more" | "send" | null>(null);
  const [note, setNote] = useState("");
  const [undo, setUndo] = useState<{ card: ReviewCard; act: Act; until: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);

  const top = cards[0];

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), Math.max(0, undo.until - Date.now()));
    return () => clearTimeout(t);
  }, [undo]);

  const next = useCallback((update: (cs: ReviewCard[]) => ReviewCard[]) => {
    setCards(update);
    setSlide(0);
    setDetails(false);
    setDrag({ x: 0, active: false });
    setEntering(true);
    setTimeout(() => setEntering(false), 300);
  }, []);

  const decide = useCallback(
    async (act: Act, comment?: string) => {
      if (!top || busy) return;
      setBusy(true);
      setError(null);
      setSheet(null);
      setLeaving(act);
      try {
        await send(top.id, { action: act, versionId: top.versionId, comment: comment ?? null });
        setTimeout(() => {
          next((cs) => cs.slice(1));
          setLeaving(null);
          setNote("");
          setUndo({ card: top, act, until: Date.now() + 10_000 });
        }, 220);
      } catch (e) {
        setLeaving(null);
        setDrag({ x: 0, active: false });
        setError((e as Error).message);
      } finally {
        setTimeout(() => setBusy(false), 240);
      }
    },
    [top, busy, next],
  );

  const later = useCallback(() => {
    setSheet(null);
    next((cs) => (cs.length > 1 ? [...cs.slice(1), cs[0]] : cs));
  }, [next]);

  const doUndo = useCallback(async () => {
    if (!undo) return;
    try {
      await send(undo.card.id, { action: "undo" });
      next((cs) => [undo.card, ...cs]);
      setUndo(null);
    } catch (e) {
      setUndo(null);
      setError((e as Error).message);
    }
  }, [undo, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || (e.target as HTMLElement)?.tagName === "TEXTAREA") {
        if (e.key === "Escape") setSheet(null);
        return;
      }
      if (e.key === "ArrowRight") decide("approve");
      else if (e.key === "ArrowLeft") setSheet("send");
      else if (e.key === "l" || e.key === "ArrowDown") later();
      else if (e.key === "u") doUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, later, doUndo, sheet]);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, video")) return;
    start.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ x: 0, active: true });
  };
  const onMove = (e: React.PointerEvent) => {
    if (start.current === null) return;
    setDrag({ x: e.clientX - start.current, active: true });
  };
  const onUp = () => {
    if (start.current === null) return;
    start.current = null;
    const x = drag.x;
    setDrag({ x: 0, active: false });
    if (x > THRESHOLD) decide("approve");
    else if (x < -THRESHOLD) setSheet("send");
  };

  const close = (
    <Link href="/" className="ib" aria-label="Close">
      <Icon name="x" />
    </Link>
  );

  if (!top) {
    return (
      <div className="focus">
        <div className="fbar">{close}</div>
        <div className="done">
          <h1>All done</h1>
          <p>Nothing left to review. Approved posts wait for their day.</p>
          <Link href="/" className="sec" style={{ marginTop: 12 }}>
            Back to inbox
          </Link>
        </div>
        {undo && <Toast undo={undo} onUndo={doUndo} />}
      </div>
    );
  }

  const media = top.media;
  const m = media[Math.min(slide, Math.max(0, media.length - 1))];
  const parts = new Set(media.map((x) => x.part));
  const loud = loudFlags(top.flags);
  const quiet = top.flags.filter((f) => !loud.some((l) => l.code === f.code));
  const channels = [...new Set(top.channels.map((c) => PLATFORM_SHORT[c.platform] ?? c.platform))];
  const fly = leaving === "approve" ? "translateX(120%)" : leaving ? "translateX(-120%)" : null;
  const cardStyle: React.CSSProperties = {
    transform: fly ?? (drag.x ? `translateX(${drag.x}px) rotate(${drag.x / 40}deg)` : undefined),
    opacity: fly ? 0 : 1,
    transition: drag.active && !leaving ? "none" : undefined,
  };
  const done = total - cards.length;

  return (
    <div className="focus">
      <div className="fbar">
        {close}
        <span className="cnt num">
          {Math.min(done + 1, total)} of {total}
        </span>
        <button className="ib" onClick={() => setSheet("more")} aria-label="More actions">
          <Icon name="more" />
        </button>
      </div>
      <div className="prog" aria-hidden>
        <i style={{ width: `${total ? Math.round((100 * done) / total) : 0}%` }} />
      </div>

      <p className="meta num" style={{ "--brand": top.brandColour } as React.CSSProperties}>
        <span className="bd" aria-hidden />
        <b>{top.brandName}</b>
        {top.localDate === today ? "Today" : shortDay(top.localDate)}, {top.localTime}
        {top.missed && " · slot passed"}
      </p>

      <div
        className="post"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label={`${top.externalId} ${top.title}`}
      >
        <div className={`card${entering ? " in" : ""}`} style={cardStyle}>
          {!m ? (
            <div className="nomedia">No image yet</div>
          ) : m.kind === "video" ? (
            <video key={m.id} src={`/api/media/${m.id}`} controls playsInline preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={m.id} src={`/api/media/${m.id}`} alt={`${PART[m.part]} ${m.position}`} draggable={false} />
          )}
        </div>
      </div>

      {media.length > 1 ? (
        <div className="pager">
          <button className="ib" onClick={() => setSlide((s) => (s - 1 + media.length) % media.length)} aria-label="Previous">
            <Icon name="left" />
          </button>
          <span className="dots" aria-hidden>
            {media.map((x, i) => (
              <i key={x.id} className={i === slide ? "on" : undefined} />
            ))}
          </span>
          {parts.size > 1 && m && <span className="part-label">{PART[m.part]}</span>}
          <button className="ib" onClick={() => setSlide((s) => (s + 1) % media.length)} aria-label="Next">
            <Icon name="right" />
          </button>
        </div>
      ) : (
        <div className="gap" />
      )}

      {error && (
        <p className="err" role="alert">
          {error} <button onClick={() => location.reload()}>Reload</button>
        </p>
      )}
      {loud.map((f, i) => (
        <p key={i} className={`flag ${f.tone === "bad" ? "bad" : ""}`}>
          <Icon name="warn" />
          {f.text}
        </p>
      ))}

      <p className={`cap${details ? " open" : ""}`}>{top.caption?.trim() || "No caption"}</p>
      {details && (
        <dl className="det num">
          <dt>Posts to</dt>
          <dd>{channels.join(", ") || "No channels"}</dd>
          <dt>Post</dt>
          <dd>
            {top.externalId}
            {top.versionNumber ? `, version ${top.versionNumber}` : ""}
          </dd>
          {top.needsYes && (
            <>
              <dt>Status</dt>
              <dd>Ready in the old queue, needs your yes here</dd>
            </>
          )}
          {top.state === "held" && top.stateReason && (
            <>
              <dt>On hold</dt>
              <dd>{top.stateReason}</dd>
            </>
          )}
          {quiet.map((f, i) => (
            <span key={i} style={{ display: "contents" }}>
              <dt>Note</dt>
              <dd>{f.text}</dd>
            </span>
          ))}
          <dt />
          <dd>
            <Link href={`/posts/${top.id}`}>Open full post</Link>
          </dd>
        </dl>
      )}
      <button className="lnk" onClick={() => setDetails((d) => !d)}>
        {details ? "Less" : "Details"}
      </button>

      <div className="acts">
        <button className="sec" onClick={() => setSheet("send")} disabled={busy}>
          Send back
        </button>
        <button className="pri" onClick={() => decide("approve")} disabled={busy}>
          Approve
        </button>
      </div>

      {sheet && <div className="scrim" onClick={() => setSheet(null)} />}
      {sheet === "more" && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="More actions">
          <div className="grab" />
          <h3>More</h3>
          <button className="opt" onClick={later} disabled={cards.length < 2}>
            <b>Later</b>
            <span>Move to the back of the pile</span>
          </button>
          <button className="opt" onClick={() => decide("reject")}>
            <b>Drop</b>
            <span>Remove this post. The slot shows as open.</span>
          </button>
        </div>
      )}
      {sheet === "send" && (
        <form
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Send back to the maker"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) decide("revise", note);
          }}
        >
          <div className="grab" />
          <h3>Send back to the maker</h3>
          <div className="chips">
            {QUICK.map((q) => (
              <button key={q} type="button" onClick={() => setNote((n) => (n ? `${n} ${q}.` : `${q}.`))}>
                {q}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should change?"
            aria-label="Note to the maker"
            autoFocus
            required
          />
          <button type="submit" className="pri" disabled={!note.trim() || busy}>
            Send back
          </button>
        </form>
      )}
      {undo && <Toast undo={undo} onUndo={doUndo} />}
    </div>
  );
}

function Toast({ undo, onUndo }: { undo: { card: ReviewCard; act: Act }; onUndo: () => void }) {
  return (
    <div className="toast" role="status">
      <span>
        {LABEL[undo.act]} {undo.card.externalId}
      </span>
      <button onClick={onUndo}>Undo</button>
    </div>
  );
}
