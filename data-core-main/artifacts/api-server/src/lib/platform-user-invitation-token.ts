/**
 * @phase P17-E - Platform invitation token generation & verification
 */

import crypto from "crypto";

export function generatePlatformInvitationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPlatformInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyPlatformInvitationToken(token: string, storedHash: string): boolean {
  const computed = hashPlatformInvitationToken(token);
  try {
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
