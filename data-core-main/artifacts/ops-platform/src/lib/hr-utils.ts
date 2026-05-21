/**
 * Converts a human-readable string into a snake_case system identifier.
 * "Full Time" → "full_time"  |  "Annual Contract" → "annual_contract"
 * Mirrors the same function in artifacts/api-server/src/routes/hr.ts
 */
export function toCode(str: string): string {
  if (!str?.trim()) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')   // strip special chars (keep word chars, spaces, hyphens)
    .replace(/[\s\-]+/g, '_')   // spaces + hyphens → underscore
    .replace(/_+/g, '_')        // collapse consecutive underscores
    .replace(/^_|_$/g, '')      // strip leading/trailing underscores
    .slice(0, 60);
}
