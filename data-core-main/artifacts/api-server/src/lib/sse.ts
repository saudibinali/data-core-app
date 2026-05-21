import type { Response } from "express";
import { logger } from "./logger";

/**
 * In-process SSE connection registry.
 *
 * ── Data structures ──────────────────────────────────────────────────────────
 *   connections     userId → list of active Response objects (one per open tab)
 *   userWorkspaceId userId → workspaceId  (for workspace-grouped diagnostics)
 *
 * ── Diagnostics ownership ────────────────────────────────────────────────────
 *   This module owns connection-level tracking only.  It stores no personal
 *   data beyond the numeric userId / workspaceId used for routing.
 *   getConnectionCount() exposes aggregate counts for the health diagnostics
 *   API - no user-level detail is returned to callers.
 *
 * ── Why workspace tracking lives here ────────────────────────────────────────
 *   The Response objects stored in `connections` are opaque - a route handler
 *   cannot inspect them to recover the workspaceId later.  The only moment
 *   workspaceId is available is during addConnection(), so we capture it then.
 */

const connections     = new Map<number, Response[]>();
const userWorkspaceId = new Map<number, number>();

// ── Connection lifecycle ──────────────────────────────────────────────────────

export function addConnection(userId: number, res: Response, workspaceId?: number): void {
  if (!connections.has(userId)) connections.set(userId, []);
  connections.get(userId)!.push(res);

  if (workspaceId !== undefined) userWorkspaceId.set(userId, workspaceId);

  logger.debug(
    {
      userId,
      workspaceId: workspaceId ?? null,
      totalConnections: getTotalCount(),
      event: "sse_connect",
    },
    "[sse] client connected",
  );
}

export function removeConnection(userId: number, res: Response): void {
  const arr = connections.get(userId);
  if (!arr) return;

  const idx = arr.indexOf(res);
  if (idx !== -1) arr.splice(idx, 1);

  if (arr.length === 0) {
    connections.delete(userId);
    userWorkspaceId.delete(userId);
  }

  logger.debug(
    {
      userId,
      workspaceId: userWorkspaceId.get(userId) ?? null,
      totalConnections: getTotalCount(),
      event: "sse_disconnect",
    },
    "[sse] client disconnected",
  );
}

// ── Emit helpers ──────────────────────────────────────────────────────────────

/**
 * Push an SSE event to a single user across all their open tabs.
 * Returns true if at least one frame was written successfully.
 */
export function emitToUser(userId: number, event: string, data?: object): boolean {
  const arr = connections.get(userId);
  if (!arr || arr.length === 0) return false;

  const payload  = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  let delivered  = false;

  for (const res of arr) {
    try {
      res.write(payload);
      delivered = true;
    } catch {
      // Connection may have already closed; removeConnection fires on req "close".
    }
  }

  logger.debug(
    {
      userId,
      workspaceId: userWorkspaceId.get(userId) ?? null,
      eventType: event,
      delivered,
      event: "sse_emit",
    },
    "[sse] emitToUser",
  );

  return delivered;
}

/**
 * Push an SSE event to multiple users at once.
 */
export function emitToUsers(userIds: number[], event: string, data?: object): void {
  for (const uid of userIds) emitToUser(uid, event, data);
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

/**
 * Return aggregate connection counts for the health diagnostics API.
 * No personal data is exposed - only numeric counts keyed by workspaceId.
 *
 *   total          - sum of all active SSE Response objects (all users, all tabs)
 *   connectedUsers - number of distinct users with ≥1 active connection
 *   perWorkspace   - workspaceId → count of connected users in that workspace
 *                    (users, not connections: one user with 3 tabs = 1 here)
 */
export function getConnectionCount(): {
  total: number;
  connectedUsers: number;
  perWorkspace: Record<number, number>;
} {
  const perWorkspace: Record<number, number> = {};

  for (const [userId, resArr] of connections) {
    if (resArr.length === 0) continue;
    const wsId = userWorkspaceId.get(userId);
    if (wsId !== undefined) {
      perWorkspace[wsId] = (perWorkspace[wsId] ?? 0) + 1;
    }
  }

  return {
    total: getTotalCount(),
    connectedUsers: connections.size,
    perWorkspace,
  };
}

// ── Internal ──────────────────────────────────────────────────────────────────

function getTotalCount(): number {
  let n = 0;
  for (const arr of connections.values()) n += arr.length;
  return n;
}
