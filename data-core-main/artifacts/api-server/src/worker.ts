/**
 * F10.2 — Standalone background worker entry (no HTTP).
 * Usage: WORKER_MODE=worker node dist/worker.mjs
 */
import { logger } from "./lib/logger";
import { assertProductionSecrets } from "./lib/security-config";
import { isDatabaseConfigured } from "@workspace/db";
import { runWorkerInitSequence } from "./lib/worker-init-sequence";

assertProductionSecrets();

if (!isDatabaseConfigured()) {
  logger.error("DATABASE_URL required for worker process");
  process.exit(1);
}

runWorkerInitSequence()
  .then(() => {
    logger.info("Worker process running (background jobs only)");
  })
  .catch((err) => {
    logger.error({ err }, "Worker init failed");
    process.exit(1);
  });
