import { createHash } from "node:crypto";

/** Format Date to HH:MM in local wall time (server uses UTC parts for consistency). */
export function toHHMM(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Local calendar date YYYY-MM-DD from occurred_at using IANA-ish offset via timezone label. */
export function toLocalDateString(occurredAt: Date, timezone: string): string {
  try {
    return occurredAt.toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    return occurredAt.toISOString().slice(0, 10);
  }
}

export function parseHHMMToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesBetweenHHMM(start: string, end: string): number {
  const a = parseHHMMToMinutes(start);
  const b = parseHHMMToMinutes(end);
  if (a == null || b == null) return 0;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

export function hashPayload(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

export const SOURCE_PRIORITY: Record<string, number> = {
  manual: 100,
  web: 80,
  excel: 60,
  system: 40,
};
