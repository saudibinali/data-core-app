/**
 * @phase P17-E - Platform invitation static / UI tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  PLATFORM_INVITATION_SAFETY_CONTRACT,
  P17E_FORBIDDEN_UI_TERMS,
  ACTIVATION_LINK_ONCE_NOTICE,
} from "../platform-user-invitation-config";
import { PLATFORM_PERMISSION_CODES } from "../platform-permissions-config";
import { hasPlatformPermissionClient } from "../platform-access";

const opsRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(__dirname, "../../../../../");

function readFromOps(rel: string): string {
  return readFileSync(resolve(opsRoot, rel), "utf8");
}

function readFromRepo(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("P17-E safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(PLATFORM_INVITATION_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions count", () => {
  it("55 platform permission codes", () => {
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.invitations.read");
  });

  it("platform_admin can create invitations", () => {
    expect(
      hasPlatformPermissionClient(
        { role: "super_admin", platformRoleCode: "platform_admin" },
        "platform.invitations.create",
      ),
    ).toBe(true);
  });

  it("auditor can read invitations only", () => {
    const auditor = { role: "super_admin", platformRoleCode: "auditor" };
    expect(hasPlatformPermissionClient(auditor, "platform.invitations.read")).toBe(true);
    expect(hasPlatformPermissionClient(auditor, "platform.invitations.create")).toBe(false);
  });
});

describe("invitation UI section", () => {
  const section = readFromOps("src/components/platform-users/InvitationActivationSection.tsx");
  const usersPage = readFromOps("src/pages/super-admin-platform-users.tsx");

  it("renders invitation activation section", () => {
    expect(section).toContain('data-testid="invitation-activation-section"');
    expect(section).toContain("Invitation & Activation");
    expect(readFromOps("src/components/platform-users/PlatformUserDetailDrawer.tsx")).toContain(
      "InvitationActivationSection",
    );
  });

  it("shows activation link once notice", () => {
    expect(section).toContain("ACTIVATION_LINK_ONCE_NOTICE");
    expect(ACTIVATION_LINK_ONCE_NOTICE).toContain("shown once");
    expect(section).toContain('data-testid="activation-url-once-dialog"');
    expect(section).toContain('data-testid="copy-activation-url"');
  });

  it("forbidden UI terms absent", () => {
    for (const term of P17E_FORBIDDEN_UI_TERMS) {
      expect(section.includes(term), term).toBe(false);
    }
  });

  it("no email sending in section", () => {
    expect(section.toLowerCase()).not.toContain("smtp");
    expect(section).not.toContain("Send Email");
  });
});

describe("activation page", () => {
  const page = readFromOps("src/pages/platform-activate.tsx");
  const app = readFromOps("src/App.tsx");

  it("route registered at /platform/activate", () => {
    expect(app).toContain('path="/platform/activate"');
    expect(app).toContain("PlatformActivatePage");
  });

  it("verify and accept without forbidden flows", () => {
    expect(page).toContain('data-testid="platform-activate-page"');
    expect(page).toContain("PLATFORM_INVITATION_API.verify");
    expect(page).toContain("PLATFORM_INVITATION_API.accept");
    expect(page).not.toContain("Reset Password");
    expect(page).not.toContain("MFA");
  });
});

describe("backend invitation routes", () => {
  const routes = readFromRepo("artifacts/api-server/src/routes/platform-user-invitations.ts");
  const service = readFromRepo("artifacts/api-server/src/lib/platform-user-invitations.ts");

  it("authenticated routes require invitation permissions", () => {
    expect(routes).toContain('requirePlatformPermission("platform.invitations.read")');
    expect(routes).toContain('requirePlatformPermission("platform.invitations.create")');
    expect(routes).toContain('requirePlatformPermission("platform.invitations.revoke")');
  });

  it("public verify does not expose tokenHash", () => {
    expect(routes).toContain("/platform/invitations/verify");
    expect(routes).not.toContain("tokenHash");
  });

  it("list/create responses use shownOnce pattern", () => {
    expect(routes).toContain("shownOnce: true");
    expect(routes).not.toContain("DELETE");
  });

  it("no email sending in service", () => {
    const lower = service.toLowerCase();
    expect(lower).not.toContain("smtp");
    expect(lower).not.toContain("sendgrid");
    expect(lower).not.toContain("nodemailer");
    expect(service).not.toContain("sendEmail");
  });

  it("audit calls pass safe metadata only", () => {
    const auditCalls = service.match(/writeInvitationAudit\([^)]+\{[\s\S]*?\}\)/g) ?? [];
    expect(auditCalls.length).toBeGreaterThan(0);
    for (const call of auditCalls) {
      expect(call).not.toContain("activationToken");
      expect(call).not.toContain("tokenHash");
    }
  });
});

describe("schema", () => {
  const schema = readFromRepo("lib/db/src/schema/platform-user-invitations.ts");

  it("platform_user_invitations table with core fields", () => {
    expect(schema).toContain("platform_user_invitations");
    expect(schema).toContain("tokenHash");
    expect(schema).toContain("expiresAt");
    expect(schema).toContain("revokeReason");
    const config = readFromRepo("artifacts/api-server/src/lib/platform-user-invitation-config.ts");
    expect(config).toContain("expired");
    expect(config).toContain("revoked");
    expect(config).toContain("accepted");
  });
});
