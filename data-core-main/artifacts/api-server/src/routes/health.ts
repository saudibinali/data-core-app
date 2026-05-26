import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getConnectionCount } from "../lib/sse";
import {
  formatPrometheusMetrics,
  isMetricsEndpointEnabled,
} from "../lib/health/prometheus-metrics";
import { countPendingOutboxRows } from "../lib/events/outbox";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
} from "../middlewares/requireAuth";

const router: IRouter = Router();

// ── GET /healthz ──────────────────────────────────────────────────────────────

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// F8.2 — Prometheus metrics (super_admin, disable via METRICS_ENABLED=false)
router.get("/health/metrics", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  if (!isMetricsEndpointEnabled()) {
    res.status(404).json({ error: "Metrics disabled", code: "METRICS_DISABLED" });
    return;
  }
  const pendingOutbox = await countPendingOutboxRows();
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(formatPrometheusMetrics({ event_outbox_pending: pendingOutbox }));
});

// ── GET /health/sse-connections ───────────────────────────────────────────────
//
// SSE connection diagnostics - super_admin only.
//
// ── Why super_admin only ──────────────────────────────────────────────────────
//   Connection counts are cross-workspace aggregates.  A workspace admin must
//   not be able to observe how many users in OTHER workspaces are online.
//   super_admin has platform-wide visibility and is the correct scope here.
//
// ── What is NOT returned ─────────────────────────────────────────────────────
//   No user IDs, names, IP addresses, or message content - only numeric counts.
//   Per-workspace counts show connected users (not raw connection objects), so
//   a user with 3 open tabs still counts as 1 in perWorkspace.
//
// ── Snapshot semantics ────────────────────────────────────────────────────────
//   This reflects current in-process state only.  Counts reset on server
//   restart.  For historical connection data, use server access logs.

router.get(
  "/health/sse-connections",
  requireAuth,
  requireSuperAdmin,
  async (_req: AuthRequest, res): Promise<void> => {
    const counts = getConnectionCount();
    res.json({
      total:          counts.total,
      connectedUsers: counts.connectedUsers,
      perWorkspace:   counts.perWorkspace,
      note:           "Snapshot of current in-process SSE connections. Resets on server restart.",
    });
  },
);

export default router;
