/**
 * P20-C — Advanced normalization helpers (no GPS)
 */
import { minutesBetweenHHMM, parseHHMMToMinutes } from "../time-utils";

export type PunchSequenceIssue = {
  code: "missing_clock_in" | "missing_clock_out" | "invalid_sequence" | "duplicate_punch";
  message: string;
};

export type NormalizationWarning = {
  code: string;
  message: string;
};

const VALID_STATUSES = new Set([
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
  "holiday",
  "remote",
]);

export function validatePunchSequence(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  options?: { allowNightShift?: boolean },
): PunchSequenceIssue[] {
  const issues: PunchSequenceIssue[] = [];
  const hasIn = Boolean(checkIn?.trim());
  const hasOut = Boolean(checkOut?.trim());

  if (hasOut && !hasIn) {
    issues.push({ code: "missing_clock_in", message: "check_out without check_in" });
  }
  if (hasIn && hasOut && checkIn && checkOut) {
    const inM = parseHHMMToMinutes(checkIn);
    const outM = parseHHMMToMinutes(checkOut);
    if (inM != null && outM != null && outM < inM && !options?.allowNightShift) {
      issues.push({
        code: "invalid_sequence",
        message: "check_out before check_in (enable night shift or fix times)",
      });
    }
  }
  return issues;
}

export function detectNightShift(checkIn: string, checkOut: string): boolean {
  const inM = parseHHMMToMinutes(checkIn);
  const outM = parseHHMMToMinutes(checkOut);
  if (inM == null || outM == null) return false;
  return outM < inM;
}

export function pairMissingPunches(
  events: Array<{ eventType: string; occurredAt: Date }>,
): NormalizationWarning[] {
  const warnings: NormalizationWarning[] = [];
  const ins = events.filter((e) => e.eventType === "clock_in");
  const outs = events.filter((e) => e.eventType === "clock_out");
  if (ins.length === 0 && outs.length > 0) {
    warnings.push({ code: "missing_punch_in", message: "Day has clock_out without clock_in" });
  }
  if (ins.length > 0 && outs.length === 0) {
    warnings.push({ code: "missing_punch_out", message: "Day has clock_in without clock_out" });
  }
  if (ins.length > 1 || outs.length > 1) {
    warnings.push({ code: "duplicate_punch", message: "Multiple punches of same type on day" });
  }
  return warnings;
}

export function resolveSourceConflict(
  sources: Array<{ code: string; priority: number }>,
): { winner: string; conflict: boolean } {
  if (sources.length === 0) return { winner: "manual", conflict: false };
  const sorted = [...sources].sort((a, b) => b.priority - a.priority);
  const top = sorted[0]!.priority;
  const winners = sorted.filter((s) => s.priority === top);
  return {
    winner: winners[0]!.code,
    conflict: winners.length > 1 && winners[0]!.code !== winners[1]!.code,
  };
}

export function normalizeTimezoneDate(occurredAt: Date, timezone: string): string {
  try {
    return occurredAt.toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    return occurredAt.toISOString().slice(0, 10);
  }
}

export function validateStatus(status: string): boolean {
  return VALID_STATUSES.has(status);
}

export function mapLegacySourceType(sourceType: string | undefined): string {
  const s = (sourceType ?? "manual").toLowerCase();
  if (s === "excel" || s === "import") return "excel";
  return s;
}

export function computeWorkedMinutesWithNightShift(
  checkIn: string,
  checkOut: string,
): number {
  return minutesBetweenHHMM(checkIn, checkOut);
}
