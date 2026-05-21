/**
 * platform-me.routes.test.ts — self-management routes for platform / root owner.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import bcrypt from "bcryptjs";

const ROOT_ID = 1;
const ROOT_HASH = "$2a$12$rootpasswordhashplaceholder";

let authWorkspaceId: number | null | undefined = undefined;
let authUserId = ROOT_ID;
let authRole = "super_admin";
let authIsRootOwner = true;

const selectResult = vi.fn<() => Promise<unknown[]>>();
const updateWhere = vi.fn(() => Promise.resolve());

function selectChain() {
  const rows = () => selectResult();
  const c = {
    from: vi.fn(() => c),
    where: vi.fn(() => c),
    limit: vi.fn(() => rows()),
    then: (
      onfulfilled?: (value: unknown[]) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => rows().then(onfulfilled, onrejected),
  };
  return c;
}

function updateChain() {
  const c: Record<string, unknown> = {
    set: vi.fn(() => c),
    where: updateWhere,
  };
  return c;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => selectChain()),
    update: vi.fn(() => updateChain()),
  },
  usersTable: {},
  platformSettingsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq" }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  ne: (_a: unknown, _b: unknown) => ({ op: "ne" }),
  isNull: (_a: unknown) => ({ op: "isNull" }),
}));

vi.mock("../../lib/platform-effective-permissions", () => ({
  resolvePlatformUserEffectivePermissions: vi.fn(async () => ({
    effectivePermissions: ["platform.users.view"],
  })),
}));

vi.mock("../../lib/platform-password-policy", () => ({
  loadPlatformPasswordPolicy: vi.fn(async () => ({
    minLength: 8,
    requireUppercase: false,
    requireSpecial: false,
    requireNumber: false,
  })),
  validatePasswordAgainstPolicy: vi.fn(() => ({ valid: true, errors: [] })),
  passwordPolicyErrorMessage: vi.fn(() => "weak"),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const r = req as express.Request & {
      userId?: number;
      userRole?: string;
      workspaceId?: number | null;
      platformRoleCode?: string | null;
      isRootOwner?: boolean;
      log?: { info: () => void };
    };
    r.userId = authUserId;
    r.userRole = authRole;
    r.workspaceId = authWorkspaceId;
    r.platformRoleCode = null;
    r.isRootOwner = authIsRootOwner;
    r.log = { info: vi.fn() };
    next();
  },
}));

const { default: platformMeRouter } = await import("../platform-me");

const app = express();
app.use(express.json());
app.use("/api", platformMeRouter);

const rootRow = {
  id: ROOT_ID,
  email: "root@platform.local",
  fullName: "Root Owner",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: null,
  isRootOwner: true,
  status: "active",
  platformJobTitle: null,
  platformDepartment: null,
  platformPhone: null,
  employeeNumber: null,
  mustResetPassword: false,
  passwordHash: ROOT_HASH,
};

beforeEach(() => {
  authWorkspaceId = undefined;
  authUserId = ROOT_ID;
  authRole = "super_admin";
  authIsRootOwner = true;
  selectResult.mockReset();
  updateWhere.mockReset();
  vi.spyOn(bcrypt, "compare").mockImplementation(async (plain: string) => plain === "CurrentPass1!");
  vi.spyOn(bcrypt, "hash").mockResolvedValue("new-hash" as never);
});

describe("GET /api/platform/me", () => {
  it("allows legacy root owner when workspaceId is undefined (requireAuth mapping)", async () => {
    selectResult.mockResolvedValueOnce([rootRow]);
    const res = await request(app).get("/api/platform/me");
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("root@platform.local");
    expect(res.body.canSelfManageAccount).toBe(true);
  });

  it("allows super_admin even when workspaceId is set on account", async () => {
    authWorkspaceId = 5;
    selectResult.mockResolvedValueOnce([{ ...rootRow, workspaceId: 5 }]);
    const res = await request(app).get("/api/platform/me");
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("root@platform.local");
  });

  it("blocks non-super_admin roles", async () => {
    authRole = "admin";
    authWorkspaceId = 1;
    const res = await request(app).get("/api/platform/me");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_PLATFORM_SELF_SERVICE");
  });
});

describe("PATCH /api/platform/me/profile", () => {
  it("allows root owner to update own profile", async () => {
    selectResult.mockResolvedValueOnce([{ ...rootRow, fullName: "Root Updated" }]);
    const res = await request(app)
      .patch("/api/platform/me/profile")
      .send({ displayName: "Root Updated", jobTitle: "Owner" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("PATCH /api/platform/me/email", () => {
  it("allows root owner to change email with current password", async () => {
    selectResult
      .mockResolvedValueOnce([{ passwordHash: ROOT_HASH }])
      .mockResolvedValueOnce([]);
    const res = await request(app)
      .patch("/api/platform/me/email")
      .send({ email: "newroot@platform.local", currentPassword: "CurrentPass1!" });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("newroot@platform.local");
  });
});

describe("POST /api/platform/me/change-password", () => {
  it("allows root owner to change password", async () => {
    selectResult.mockResolvedValueOnce([{ passwordHash: ROOT_HASH }]);
    const res = await request(app)
      .post("/api/platform/me/change-password")
      .send({ currentPassword: "CurrentPass1!", newPassword: "NewSecure99" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects wrong current password with 401", async () => {
    selectResult.mockResolvedValueOnce([{ passwordHash: ROOT_HASH }]);
    vi.spyOn(bcrypt, "compare").mockResolvedValue(false as never);
    const res = await request(app)
      .post("/api/platform/me/change-password")
      .send({ currentPassword: "wrong", newPassword: "NewSecure99" });
    expect(res.status).toBe(401);
  });
});
