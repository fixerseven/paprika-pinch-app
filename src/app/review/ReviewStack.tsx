"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewCard } from "@/lib/review";

type Act = "approve" | "reject" | "revise";
const LABEL: Record<Act, string> = { approve: "Approved", reject: "Dropped", revise: "Sent back" };
const PLATFORM: Record<string, string> = { facebook: "FB", instagram: "IG", threads: "Threads" };
const THRESHOLD = 110;

function when(c: ReviewCard) {
  const d = new Date(`${c.localDate}T00:00:00Z`);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `${day}, ${c.localTime}`;
}

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

export default function ReviewStack({ initial }: { initial: ReviewCard[] }) {
  const [cards, setCards] = useState(initial);
  const [done, setDone] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [leaving, setLeaving] = useState<Act | null>(null);
  const [comment, setComment] = useState<string | null>(null); // open revise sheet when not null
  const [undo, setUndo] = useState<{ card: ReviewCard; act: Act; until: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [, tick] = useState(0);

  const top = cards[0];

  useEffect(() => {
    if (!undo) return;
    const t = setInterval(() => {
      if (Date.now() > undo.until) setUndo(null);
      tick((n) => n + 1);
    }, 500);
    return () => clearInterval(t);
  }, [undo]);

  const decide = useCallback(
    async (act: Act, note?: string) => {
      if (!top || busy) return;
      setBusy(true);
      setError(null);
      setLeaving(act);
      try {
        await send(top.id, { action: act, versionId: top.versionId, comment: note ?? null });
        setTimeout(() => {
          setCards((cs) => cs.slice(1));
          setDone((n) => n + 1);
          setLeaving(null);
          setDrag({ x: 0, y: 0, active: false });
          setUndo({ card: top, act, until: Date.now() + 10_000 });
        }, 180);
      } catch (e) {
        setLeaving(null);
        setDrag({ x: 0, y: 0, active: false });
        setError((e as Error).message);
      } finally {
        setTimeout(() => setBusy(false), 200);
      }
    },
    [top, busy],
  );

  const later = useCallback(() => {
    setCards((cs) => (cs.length > 1 ? [...cs.slice(1), cs[0]] : cs));
    setDrag({ x: 0, y: 0, active: false });
  }, []);

  const doUndo = useCallback(async () => {
    if (!undo) return;
    try {
      await send(undo.card.id, { action: "undo" });
      setCards((cs) => [undo.card, ...cs]);
      setDone((n) => Math.max(0, n - 1));
      setUndo(null);
    } catch (e) {
      setUndo(null);
      setError((e as Error).message);
    }
  }, [undo]);

  // Keyboard: → approve, ← drop, ↑ send back, ↓ later, u undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (comment !== null || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") decide("approve");
      else if (e.key === "ArrowLeft") decide("reject");
      else if (e.key === "ArrowUp") setComment("");
      else if (e.key === "ArrowDown") later();
      else if (e.key === "u") doUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, later, doUndo, comment]);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, video, .media-scroll")) return;
    start.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ x: 0, y: 0, active: true });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true });
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    const { x, y } = drag;
    if (x > THRESHOLD) decide("approve");
    else if (x < -THRESHOLD) decide("reject");
    else if (y < -THRESHOLD && Math.abs(x) < THRESHOLD) {
      setDrag({ x: 0, y: 0, active: false });
      setComment("");
    } else setDrag({ x: 0, y: 0, active: false });
  };

  const hint: Act | null = leaving ?? (drag.x > 40 ? "approve" : drag.x < -40 ? "reject" : drag.y < -40 ? "revise" : null);
  const fly =
    leaving === "approve" ? "translateX(130%) rotate(12deg)" : leaving === "reject" ? "translateX(-130%) rotate(-12deg)" : leaving === "revise" ? "translateY(-120%)" : null;
  const style: React.CSSProperties = {
    transform: fly ?? `translate(${drag.x}px, ${Math.min(drag.y, 0)}px) rotate(${drag.x / 25}deg)`,
    transition: drag.active && !leaving ? "none" : "transform 180ms ease-out",
  };

  return (
    <div className="stack-wrap">
      <p className="stack-count" aria-live="polite">
        {cards.length ? `${cards.length} to go` : "All clear"}
        {done > 0 && ` · ${done} done`}
      </p>

      {error && (
        <p className="stack-error" role="alert">
          {error} <button onClick={() => location.reload()}>Reload</button>
        </p>
      )}

      {!top ? (
        <div className="stack-empty">
          <p className="big">Nothing waiting on you.</p>
          <p className="sub">New posts from makers show up here.</p>
        </div>
      ) : (
        <>
          <article
            className={`rcard ${hint ? `hint-${hint}` : ""}`}
            style={{ ...style, "--brand": top.brandColour } as React.CSSProperties}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            aria-label={`${top.externalId} ${top.title}`}
          >
            {hint && <div className={`stamp stamp-${hint}`}>{LABEL[hint]}</div>}
            <header className="rcard-head">
              <div className="badges">
                <span className="badge-brand">
                  <span className="brand-dot" aria-hidden />
                  {top.brandName}
                </span>
                {[...new Set(top.channels.map((c) => c.platform))].map((p) => (
                  <span key={p} className="badge">
                    {PLATFORM[p] ?? p}
                  </span>
                ))}
                {top.needsYes && <span className="pill st-approved">Needs your yes</span>}
                {top.state === "held" && <span className="pill st-held">On hold</span>}
                {top.missed && <span className="pill st-failed">Slot passed</span>}
                {top.versionNumber && top.versionNumber > 1 && <span className="badge">v{top.versionNumber}</span>}
              </div>
              <h2>
                <span className="post-id">{top.externalId}</span> {top.title}
              </h2>
              <p className="sub">
                {when(top)} Manila · <a href={`/posts/${top.id}`}>Open</a>
              </p>
              {top.stateReason && top.state !== "approved" && <p className="reason">{top.stateReason}</p>}
            </header>

            {top.flags.length > 0 && (
              <ul className="flag-list">
                {top.flags.map((f, i) => (
                  <li key={i} className={`flag flag-${f.code}`}>
                    {f.text}
                  </li>
                ))}
              </ul>
            )}

            {top.media.length > 0 && (
              <div className="media-scroll">
                {top.media.map((m) =>
                  m.kind === "video" ? (
                    <video key={m.id} src={`/api/media/${m.id}`} controls playsInline preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={m.id} src={`/api/media/${m.id}`} alt={`${m.part} ${m.position}`} draggable={false} />
                  ),
                )}
              </div>
            )}

            <div className="rcard-caption">{top.caption?.trim() || <em>No caption</em>}</div>
          </article>

          <div className="stack-actions">
            <button className="act act-reject" onClick={() => decide("reject")} disabled={busy} aria-label="Drop">
              ✕<span>Drop</span>
            </button>
            <button className="act act-revise" onClick={() => setComment("")} disabled={busy} aria-label="Send back">
              ↺<span>Send back</span>
            </button>
            <button className="act act-later" onClick={later} disabled={busy || cards.length < 2} aria-label="Later">
              ⤓<span>Later</span>
            </button>
            <button className="act act-approve" onClick={() => decide("approve")} disabled={busy} aria-label="Approve">
              ✓<span>Approve</span>
            </button>
          </div>
          <p className="stack-tip">Swipe right to approve, left to drop, up to send back.</p>
        </>
      )}

      {comment !== null && top && (
        <div className="sheet" role="dialog" aria-label="Send back with a note">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              const note = comment;
              setComment(null);
              decide("revise", note);
            }}
          >
            <h3>What needs to change on {top.externalId}?</h3>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} autoFocus required />
            <div className="sheet-actions">
              <button type="button" onClick={() => setComment(null)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!comment.trim()}>
                Send back
              </button>
            </div>
          </form>
        </div>
      )}

      {undo && (
        <div className="toast" role="status">
          {LABEL[undo.act]} {undo.card.externalId}
          <button onClick={doUndo}>Undo ({Math.max(0, Math.ceil((undo.until - Date.now()) / 1000))})</button>
        </div>
      )}
    </div>
  );
}
