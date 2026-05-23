/**
 * Shared normalization helpers for HR import/export runtime.
 */

/** Normalize a runtime lookup key (code/slug). */
export function normalizeRuntimeKey(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

/** Normalize a display name for case-insensitive matching. */
export function normalizeName(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

/** Case-insensitive equality on normalized names. */
export function safeCaseInsensitiveMatch(a: unknown, b: unknown): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb;
}

/** Generate a canonical slug/code from a label. */
export function canonicalSlug(value: unknown, maxLen = 64): string {
  const slug = normalizeRuntimeKey(value).replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!slug) return "item";
  return slug.length > maxLen ? slug.slice(0, maxLen) : slug;
}

/** Uniquify a code against a set of taken codes (mirrors foundation route pattern). */
export function uniquifyRuntimeCode(base: string, taken: Set<string>): string {
  let code = base || "item";
  if (!taken.has(code)) return code;
  let n = 2;
  while (taken.has(`${code}_${n}`)) n++;
  return `${code}_${n}`;
}
