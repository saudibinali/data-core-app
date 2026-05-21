/**
 * @phase P17-E - Platform invitation token helpers
 */

import { describe, it, expect } from "vitest";
import {
  generatePlatformInvitationToken,
  hashPlatformInvitationToken,
  verifyPlatformInvitationToken,
} from "../platform-user-invitation-token";

describe("P17-E token helpers", () => {
  it("generates strong random tokens", () => {
    const a = generatePlatformInvitationToken();
    const b = generatePlatformInvitationToken();
    expect(a.length).toBeGreaterThan(32);
    expect(b.length).toBeGreaterThan(32);
    expect(a).not.toBe(b);
  });

  it("stores hash only (hex sha256)", () => {
    const token = generatePlatformInvitationToken();
    const hash = hashPlatformInvitationToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(token);
  });

  it("verify accepts matching token", () => {
    const token = generatePlatformInvitationToken();
    const hash = hashPlatformInvitationToken(token);
    expect(verifyPlatformInvitationToken(token, hash)).toBe(true);
  });

  it("verify rejects wrong token", () => {
    const token = generatePlatformInvitationToken();
    const hash = hashPlatformInvitationToken(token);
    expect(verifyPlatformInvitationToken(generatePlatformInvitationToken(), hash)).toBe(false);
  });

  it("verify rejects tampered hash", () => {
    const token = generatePlatformInvitationToken();
    expect(verifyPlatformInvitationToken(token, "deadbeef")).toBe(false);
  });
});
