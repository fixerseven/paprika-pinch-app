/**
 * Caption files are Markdown with one section per post:
 *
 *   ## B13
 *   **2026-10-29 12:00 · Community · Hero line**     <- note, left out
 *   Status: ready. ...                               <- note, left out
 *
 *   Caption text exactly as posted.
 *   #Hashtags
 *
 *   ---
 *
 * Lines starting with `**` or `Status:` are notes (same rule as nest_postiz.py).
 */
export function parseCaptionFile(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  let key: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (key !== null) sections.set(key, cleanCaption(lines));
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^##\s+(\S+)\s*$/.exec(raw);
    if (m) {
      flush();
      key = m[1];
      lines = [];
    } else if (key !== null) {
      lines.push(raw);
    }
  }
  flush();
  return sections;
}

function cleanCaption(lines: string[]): string {
  const kept = lines.filter((l) => !/^\s*(\*\*|Status:)/.test(l));
  // Drop the trailing section rule and surrounding blank lines.
  while (kept.length && /^\s*(---)?\s*$/.test(kept[kept.length - 1])) kept.pop();
  while (kept.length && kept[0].trim() === "") kept.shift();
  return kept.map((l) => l.replace(/\s+$/, "")).join("\n");
}

/** Words the old scripts refused in a caption: the post isn't final while they're there. */
export const UNFINISHED_MARKERS = ["⚑", "[PRICE", "[OFFER", "TBD", "*Note", "*Add", "(Same fine print"];

export function unfinishedMarkers(caption: string): string[] {
  return UNFINISHED_MARKERS.filter((m) => caption.includes(m));
}
