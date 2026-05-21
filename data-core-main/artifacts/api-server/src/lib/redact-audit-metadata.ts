/**
 * redact-audit-metadata.ts
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 *
 * Pure helper - no DB, no HTTP, no side effects.
 * Redacts sensitive keys from audit metadata before returning to clients.
 *
 * Safety:
 *   - Redaction is recursive (objects + arrays)
 *   - Key matching is case-insensitive and substring-based
 *   - Original metadata is never mutated
 *   - Unknown types (string, number, boolean) are passed through unchanged
 */

// ── Sensitive key patterns (case-insensitive substring match) ─────────────────

const SENSITIVE_KEY_PATTERNS: readonly string[] = [
  "password",
  "token",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "credential",
];

const REDACTED_VALUE = "[REDACTED]";

// ── Key check ─────────────────────────────────────────────────────────────────

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[_\-\s]/g, "");
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ── Recursive redaction ───────────────────────────────────────────────────────

export function redactAuditMetadata(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(redactAuditMetadata);
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactAuditMetadata(val);
    }
    return result;
  }

  // Primitives: string, number, boolean, bigint - pass through unchanged
  return value;
}

/**
 * Safely parses a JSON metadata string, redacts sensitive keys, and returns
 * the safe object. Returns null if the string is null/undefined/invalid JSON.
 */
export function parseAndRedactMetadata(metadataJson: string | null | undefined): Record<string, unknown> | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return redactAuditMetadata(parsed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export { SENSITIVE_KEY_PATTERNS, REDACTED_VALUE };
