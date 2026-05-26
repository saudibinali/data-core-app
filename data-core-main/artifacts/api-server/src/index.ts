import app from "./app";
import { logger } from "./lib/logger";
import { isDatabaseConfigured } from "@workspace/db";
import { runInitSequence } from "./lib/init-sequence";
import { assertProductionSecrets } from "./lib/security-config";
import { getRuntimeMode, shouldStartHttpServer } from "./lib/runtime-mode";

assertProductionSecrets();

if (!shouldStartHttpServer()) {
  logger.error(
    { mode: getRuntimeMode() },
    "WORKER_MODE=worker — start dist/worker.mjs instead of index.mjs",
  );
  process.exit(1);
}

// PORT - defaults to 8080 so the server starts without manual env setup.
const port = Number(process.env["PORT"] ?? "8080");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

// Database connection is initialized by @workspace/db unified resolver at import time
// (process.env.DATABASE_URL → data/.platform.json). Setup wizard still persists via platform-config.

// ── Start HTTP server ─────────────────────────────────────────────────────────
app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Run the full init sequence only when a database is actually available.
  // When DATABASE_URL is missing the server stays up in "setup mode" and the
  // UI wizard will call POST /api/setup/database to configure and init.
  if (!isDatabaseConfigured()) {
    logger.info("No database configured - server running in setup mode. Open the UI to complete configuration.");
    return;
  }

  try {
    await runInitSequence();
  } catch (err) {
    logger.error({ err }, "Initialization sequence failed — API cannot start safely");
    process.exit(1);
  }
});
