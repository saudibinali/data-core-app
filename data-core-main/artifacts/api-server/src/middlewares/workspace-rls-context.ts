/**
 * F2.2 — Set PostgreSQL session variable for optional RLS pilot.
 */

import { pool } from "@workspace/db";
import type { AuthRequest } from "./requireAuth";
import { isWorkspaceRlsEnforced } from "../lib/workspace-rbac-config";
import { logger } from "../lib/logger";

export async function setWorkspaceRlsSessionContext(req: AuthRequest): Promise<void> {
  if (!req.workspaceId) return;

  try {
    await pool.query(`SELECT set_config('app.current_workspace_id', $1, true)`, [
      String(req.workspaceId),
    ]);
    await pool.query(`SELECT set_config('app.rls_enforce', $1, true)`, [
      isWorkspaceRlsEnforced() ? "true" : "false",
    ]);
  } catch (err) {
    logger.warn({ err, workspaceId: req.workspaceId }, "[rls] failed to set session context");
  }
}
