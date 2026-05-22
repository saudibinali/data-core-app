/**
 * Shared validation helpers for operational commercial routes.
 */

export function parseOptionalDate(v: unknown): string | null | "INVALID" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "INVALID";
  const s = v.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "INVALID";
  if (Number.isNaN(new Date(`${s}T00:00:00.000Z`).getTime())) return "INVALID";
  return s;
}

/** Never persist parse sentinels to PostgreSQL. */
export function dateFieldToNull(v: string | null | "INVALID" | "MISSING"): string | null {
  if (v === "MISSING" || v === "INVALID") return null;
  return v;
}

export function pgErrorInfo(e: unknown): { code?: string; message?: string } {
  if (typeof e !== "object" || e === null) return {};
  const row = e as { code?: string; message?: string };
  return { code: row.code, message: row.message };
}

export function isSchemaMismatchError(e: unknown): boolean {
  const { code, message } = pgErrorInfo(e);
  return (
    code === "42703" ||
    code === "42P01" ||
    (typeof message === "string" &&
      (/column.*does not exist/i.test(message) || /relation.*does not exist/i.test(message)))
  );
}
