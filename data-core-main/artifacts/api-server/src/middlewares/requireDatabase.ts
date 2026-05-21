import { type Request, type Response, type NextFunction } from "express";
import { isDatabaseConfigured } from "@workspace/db";

/**
 * Middleware that short-circuits any route requiring a database connection.
 * Mount this BEFORE all DB-dependent routers so the server boots cleanly
 * even when the database has not yet been configured via the setup wizard.
 *
 * Routes that must always be reachable (health, setup/*) should be registered
 * BEFORE this middleware in the router stack.
 */
export function requireDatabase(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isDatabaseConfigured()) {
    res.status(503).json({
      error: "Database not configured",
      databaseReady: false,
      message:
        "The database connection has not been configured yet. " +
        "Complete the setup wizard to continue.",
    });
    return;
  }
  next();
}
