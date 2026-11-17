/**
 * Convert a wall-clock date and time in an IANA timezone to a UTC ISO string.
 * Works for zones with daylight saving too: it corrects using the zone's own
 * offset at that moment.
 */
export function localToUtc(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) {
    throw new Error(`bad date or time: ${date} ${time}`);
  }
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offset = zoneOffsetMs(asIfUtc, timeZone);
  let utc = asIfUtc - offset;
  // Second pass in case the offset differs at the corrected instant (DST edges).
  const offset2 = zoneOffsetMs(utc, timeZone);
  if (offset2 !== offset) utc = asIfUtc - offset2;
  return new Date(utc).toISOString();
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(instant / 1000) * 1000;
}

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
