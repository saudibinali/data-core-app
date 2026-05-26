/** Client idempotency key for safe POST retries (RFC-style, max 128 chars). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function idempotencyRequestInit(): RequestInit {
  return { headers: { "Idempotency-Key": newIdempotencyKey() } };
}
