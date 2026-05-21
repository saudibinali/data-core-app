/**
 * @phase P17-F - Platform Users Console read-only aggregation APIs
 */

import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePlatformPermission } from "../middlewares/requireAuth";
import {
  buildPlatformUserConsole,
  buildPlatformUsersConsoleSummary,
} from "../lib/platform-user-console";

const router: IRouter = Router();

router.get(
  "/platform/users/console-summary",
  requireAuth,
  requirePlatformPermission("platform.users.read"),
  async (_req: AuthRequest, res): Promise<void> => {
    const summary = await buildPlatformUsersConsoleSummary();
    res.json(summary);
  },
);

router.get(
  "/platform/users/:userId/console",
  requireAuth,
  requirePlatformPermission("platform.users.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }
    const consoleData = await buildPlatformUserConsole(userId);
    if (!consoleData) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }
    res.json(consoleData);
  },
);

export default router;
