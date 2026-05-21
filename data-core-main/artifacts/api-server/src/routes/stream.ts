import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import { addConnection, removeConnection } from "../lib/sse";

const router: IRouter = Router();

/**
 * GET /stream
 *
 * Server-Sent Events endpoint.  The client connects once after sign-in and
 * keeps the connection alive.  When the server needs to notify the client
 * (new message, new notification, ...) it calls emitToUser() which writes an
 * SSE frame to every open connection for that user.
 *
 * Native EventSource does not support custom headers, so the frontend uses a
 * fetch-based reader that can attach the Bearer token.
 *
 * workspaceId is forwarded to addConnection() so that the SSE diagnostics API
 * (GET /health/sse-connections) can report per-workspace connection counts
 * without storing any personal data.
 */
router.get("/stream", requireAuth, (req: AuthRequest, res): void => {
  if (!req.userId) {
    res.status(401).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");
  // Disable nginx / Replit proxy buffering so frames arrive immediately.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Disable Nagle's algorithm - send each SSE frame without waiting to batch.
  req.socket?.setNoDelay(true);

  // Confirm the connection is live.
  res.write("event: connected\ndata: {}\n\n");

  addConnection(req.userId, res, req.workspaceId ?? undefined);

  // Heartbeat every 4 s - the Replit proxy closes idle SSE connections in ~5 s.
  const heartbeat = setInterval(() => {
    try {
      res.write("event: ping\ndata: {}\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 4_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeConnection(req.userId!, res);
  });
});

export default router;
