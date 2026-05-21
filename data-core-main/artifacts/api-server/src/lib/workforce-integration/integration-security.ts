/**
 * P20-E — Integration security helpers (no raw credential exposure)
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function hashWebhookSecret(secret: string): string {
  const salt = "attendance-webhook-v1";
  return scryptSync(secret, salt, 32).toString("hex");
}

export function verifyWebhookSecret(secret: string, storedHash: string | null): boolean {
  if (!storedHash || !secret) return false;
  const computed = hashWebhookSecret(secret);
  try {
    return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(storedHash, "hex"));
  } catch {
    return false;
  }
}

export function signWebhookPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  const expected = signWebhookPayload(secret, rawBody);
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/** In-memory replay cache (per process); production would use DB nonce table */
const replayCache = new Map<string, number>();

export function checkReplayToken(integrationId: number, token: string | undefined): boolean {
  if (!token) return true;
  const key = `${integrationId}:${token}`;
  const now = Date.now();
  if (replayCache.has(key)) return false;
  replayCache.set(key, now);
  for (const [k, ts] of replayCache) {
    if (now - ts > REPLAY_WINDOW_MS) replayCache.delete(k);
  }
  return true;
}

export function parseConfigJson(raw: string | null): Record<string, unknown> {
  if (!raw || raw === "{}") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
