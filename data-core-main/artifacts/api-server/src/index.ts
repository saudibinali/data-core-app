import app from "./app";
import { logger } from "./lib/logger";
import { isDatabaseConfigured, initializeDatabase } from "@workspace/db";
import { loadPlatformConfig } from "./lib/platform-config";
import { runInitSequence } from "./lib/init-sequence";

// PORT - defaults to 8080 so the server starts without manual env setup.
const port = Number(process.env["PORT"] ?? "8080");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

// ── Pre-start: load persisted config if DATABASE_URL not in environment ───────
// This allows the DB URL to be configured once via the setup wizard and then
// restored automatically on every subsequent restart.
if (!isDatabaseConfigured()) {
  const config = loadPlatformConfig();
  if (config.databaseUrl) {
    logger.info("Restoring database connection from saved platform config");
    initializeDatabase(config.databaseUrl);
  }
}

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
    logger.error({ err }, "Initialization sequence failed - server may be partially operational");
  }
});
