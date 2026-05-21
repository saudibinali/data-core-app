/**
 * @phase P17-G - Phase 17 closure: integration QA scenarios (static verification)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT } from "../platform-users-console-config";
import { PLATFORM_INVITATION_SAFETY_CONTRACT } from "../platform-user-invitation-config";
import { ACCESS_REVIEW_SAFETY_CONTRACT } from "../platform-access-review-config";
import { PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT } from "../platform-permission-assignment-config";
import { SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT } from "../platform-admin-protection-config";
import { PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT } from "../platform-user-directory-config";

const repoRoot = resolve(__dirname, "../../../../../");
const opsRoot = resolve(__dirname, "../../..");

function readRepo(rel: string) {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

function readOps(rel: string) {
  return readFileSync(resolve(opsRoot, rel), "utf8");
}

const PHASE17_FORBIDDEN = [
  "smtp",
  "sendgrid",
  "nodemailer",
  "password reset",
  "mfa",
  "sso",
  "stripe",
  "checkout",
  "emergency access",
  "approval workflow",
  "make root owner",
  "remove root owner",
  "hard delete",
  "tenant invitation",
  "workspace invitation",
];

describe("P17-G safety contracts", () => {
  const contracts = [
    PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT,
    PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT,
    SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT,
    ACCESS_REVIEW_SAFETY_CONTRACT,
    PLATFORM_INVITATION_SAFETY_CONTRACT,
    PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT,
  ];

  it("all phase safety contracts are fully true", () => {
    for (const c of contracts) {
      for (const [k, v] of Object.entries(c)) {
        expect(v, k).toBe(true);
      }
    }
  });
});

describe("Scenario A — Create platform user", () => {
  const routes = readRepo("artifacts/api-server/src/routes/platform-users.ts");
  const lifecycle = readRepo("artifacts/api-server/src/lib/platform-user-lifecycle.ts");
  it("POST create with audit and no hard delete", () => {
    expect(routes).toContain('router.post(\n  "/platform/users"');
    expect(routes).toContain("platform_user_created");
    expect(routes).not.toContain("router.delete");
    expect(lifecycle).toContain("normalizePlatformUserEmail");
  });
});

describe("Scenario B — Invite and activate", () => {
  const inv = readRepo("artifacts/api-server/src/lib/platform-user-invitations.ts");
  const token = readRepo("artifacts/api-server/src/lib/platform-user-invitation-token.ts");
  it("token hashed, no email, one-time response", () => {
    expect(token).toContain("hashPlatformInvitationToken");
    expect(inv).not.toMatch(/sendEmail|smtp|nodemailer/i);
    expect(readRepo("artifacts/api-server/src/routes/platform-user-invitations.ts")).toContain("shownOnce: true");
    expect(inv).toContain("platform_user_invitation_accepted");
  });
});

describe("Scenario C — Custom permissions", () => {
  const eff = readRepo("artifacts/api-server/src/lib/platform-effective-permissions.ts");
  it("deny wins and effective resolver", () => {
    expect(eff).toContain("computeEffectivePermissionsFromRoleAndOverrides");
    expect(eff).toMatch(/deny/i);
  });
});

describe("Scenario D — Protection", () => {
  const ev = readRepo("artifacts/api-server/src/lib/platform-admin-protection-evaluator.ts");
  it("evaluator blocks self-disable and root immutable", () => {
    expect(ev).toContain("SELF_DISABLE_BLOCKED");
    expect(ev).toContain("ROOT_OWNER_IMMUTABLE");
    expect(ev).toContain("LAST_ROOT_OWNER_BLOCKED");
  });
  it("blocked reason formatting in ops", () => {
    expect(readOps("src/lib/platform-admin-protection-config.ts")).toContain("formatProtectionBlockedReason");
  });
});

describe("Scenario E — Access review", () => {
  const review = readRepo("artifacts/api-server/src/lib/platform-access-review.ts");
  it("sanitized metadata and review only", () => {
    expect(review).toContain("sanitizeAuditMetadataForReview");
    expect(review).toContain("buildPlatformAccessReviewSummary");
    expect(readRepo("artifacts/api-server/src/routes/platform-access-review.ts")).not.toContain(
      "platform.permissions.update",
    );
  });
});

describe("Scenario F — Console", () => {
  it("unified console components wired", () => {
    const page = readOps("src/pages/super-admin-platform-users.tsx");
    expect(page).toContain("PlatformUsersSummaryCards");
    expect(page).toContain("PlatformUserDetailDrawer");
    expect(readOps("src/components/layout/super-admin-layout.tsx")).toContain("nav-more-dropdown");
  });
});

describe("Scenario G — Boundaries", () => {
  const permRoutes = readRepo("artifacts/api-server/src/routes/platform-user-permissions.ts");
  const userRoutes = readRepo("artifacts/api-server/src/routes/platform-users.ts");
  it("platform scope only", () => {
    expect(userRoutes).toContain("isNull(usersTable.workspaceId)");
    expect(permRoutes).not.toContain("/tenant/");
    expect(permRoutes).not.toMatch(/workspace.*permission/i);
  });
});

function stripSourceComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Phase 17 boundary scan", () => {
  const core = stripSourceComments(
    [
      readRepo("artifacts/api-server/src/routes/platform-users.ts"),
      readRepo("artifacts/api-server/src/routes/platform-user-permissions.ts"),
      readRepo("artifacts/api-server/src/routes/platform-user-invitations.ts"),
      readOps("src/pages/super-admin-platform-users.tsx"),
    ].join("\n"),
  ).toLowerCase();

  it("no forbidden product boundaries in core P17 surfaces", () => {
    for (const term of PHASE17_FORBIDDEN) {
      expect(core.includes(term), `found: ${term}`).toBe(false);
    }
  });
});

describe("documentation", () => {
  it("platform users doc exists", () => {
    expect(readRepo("docs/platform-users-custom-access-control.md")).toContain("Phase 17");
  });
});
