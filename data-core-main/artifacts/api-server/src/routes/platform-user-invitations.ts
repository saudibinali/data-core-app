/**
 * @phase P17-E - Platform user invitation & activation APIs
 */

import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePlatformPermission } from "../middlewares/requireAuth";
import {
  acceptPlatformUserInvitation,
  createPlatformUserInvitation,
  InvitationError,
  listPlatformUserInvitations,
  resendPlatformUserInvitation,
  revokePlatformUserInvitation,
  verifyPlatformInvitation,
} from "../lib/platform-user-invitations";

const router: IRouter = Router();

// ── Public activation (no auth) ───────────────────────────────────────────────

router.get("/platform/invitations/verify", async (req, res): Promise<void> => {
  const token = String(req.query.token ?? "");
  if (!token) {
    res.status(400).json({ error: "token query parameter is required" });
    return;
  }
  const result = await verifyPlatformInvitation(token);
  res.json({
    valid: result.valid,
    status: result.status,
    email: result.email,
    expiresAt: result.expiresAt,
    displayName: "displayName" in result ? result.displayName : null,
  });
});

router.post("/platform/invitations/accept", async (req, res): Promise<void> => {
  const { token, displayName, password, employeeNumber } = req.body as {
    token?: string;
    displayName?: string;
    password?: string;
    employeeNumber?: string;
  };

  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  try {
    const result = await acceptPlatformUserInvitation(token, {
      displayName,
      password,
      employeeNumber,
    });
    res.json({
      success: true,
      userId: result.userId,
      invitationId: result.invitationId,
      message: "Account activated. You may now sign in with your employee number and password.",
    });
  } catch (err) {
    if (err instanceof InvitationError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

// ── Authenticated platform invitation management ────────────────────────────

router.get(
  "/platform/users/:userId/invitations",
  requireAuth,
  requirePlatformPermission("platform.invitations.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }
    const invitations = await listPlatformUserInvitations(userId);
    res.json({ invitations });
  },
);

router.post(
  "/platform/users/:userId/invitations",
  requireAuth,
  requirePlatformPermission("platform.invitations.create"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    const expiryDays = req.body?.expiryDays ? Number(req.body.expiryDays) : undefined;

    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    try {
      const result = await createPlatformUserInvitation(userId, actorId, expiryDays);
      res.status(201).json({
        invitation: result.invitation,
        activationToken: result.activationToken,
        activationUrl: result.activationUrl,
        shownOnce: true,
      });
    } catch (err) {
      if (err instanceof InvitationError) {
        const status = err.code.includes("BLOCKED") || err.code.includes("IMMUTABLE") ? 403 : 400;
        res.status(status).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);

router.post(
  "/platform/users/:userId/invitations/resend",
  requireAuth,
  requirePlatformPermission("platform.invitations.create"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    const expiryDays = req.body?.expiryDays ? Number(req.body.expiryDays) : undefined;

    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    try {
      const result = await resendPlatformUserInvitation(userId, actorId, expiryDays);
      res.json({
        invitation: result.invitation,
        activationToken: result.activationToken,
        activationUrl: result.activationUrl,
        shownOnce: true,
      });
    } catch (err) {
      if (err instanceof InvitationError) {
        const status = err.code.includes("BLOCKED") || err.code.includes("IMMUTABLE") ? 403 : 400;
        res.status(status).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);

router.post(
  "/platform/invitations/:invitationId/revoke",
  requireAuth,
  requirePlatformPermission("platform.invitations.revoke"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const invitationId = parseInt(String(req.params.invitationId ?? ""), 10);
    const { reason } = req.body as { reason?: string };

    if (!invitationId || invitationId <= 0) {
      res.status(400).json({ error: "Invalid invitationId" });
      return;
    }

    try {
      const invitation = await revokePlatformUserInvitation(invitationId, actorId, reason ?? "");
      res.json({ invitation });
    } catch (err) {
      if (err instanceof InvitationError) {
        const status = err.code.includes("BLOCKED") || err.code.includes("IMMUTABLE") ? 403 : 400;
        res.status(status).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);

export default router;
