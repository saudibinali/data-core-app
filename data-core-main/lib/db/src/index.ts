import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { tryResolveDatabaseUrl } from "./resolve-database-url";

const { Pool } = pg;

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// ── Internal mutable state ───────────────────────────────────────────────────

let _pool: pg.Pool | null = null;
let _db: DrizzleDb | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true once initializeDatabase() has been called successfully.
 * Use this instead of checking pool/db directly.
 */
export function isDatabaseConfigured(): boolean {
  return _db !== null;
}

/**
 * Initialize (or re-initialize) the database connection.
 * Safe to call multiple times - the previous pool is drained gracefully.
 * Called at startup from DATABASE_URL or from the setup wizard.
 */
export function initializeDatabase(connectionString: string): void {
  if (_pool) {
    void _pool.end().catch(() => undefined);
  }
  _pool = new Pool({ connectionString });
  _db = drizzle(_pool, { schema });
}

/**
 * Proxy-based pool export.
 * The proxy forwards every property access to the current _pool instance so
 * that route files that do `import { pool }` always hit the live connection,
 * even when initializeDatabase() is called after module load time.
 */
export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    if (!_pool) {
      throw new Error(
        "Database pool is not initialized. " +
          "Provide DATABASE_URL or complete the setup wizard.",
      );
    }
    const value = Reflect.get(_pool, prop, _pool);
    return typeof value === "function" ? (value as Function).bind(_pool) : value;
  },
});

/**
 * Proxy-based drizzle export.
 * Same pattern as pool - always delegates to the current _db instance.
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    if (!_db) {
      throw new Error(
        "Database is not initialized. " +
          "Provide DATABASE_URL or complete the setup wizard.",
      );
    }
    const value = Reflect.get(_db, prop, _db);
    return typeof value === "function" ? (value as Function).bind(_db) : value;
  },
});

// ── Boot-time initialization (unified resolver) ─────────────────────────────

const _bootResolved = tryResolveDatabaseUrl();
if (_bootResolved) {
  initializeDatabase(_bootResolved.url);
}

export { resolveDatabaseUrl, tryResolveDatabaseUrl, readPlatformConfigDatabaseUrl, getPlatformConfigPath } from "./resolve-database-url";
export type { DatabaseUrlSource, ResolvedDatabaseUrl } from "./resolve-database-url";

// ── Connection test helper ────────────────────────────────────────────────────

/**
 * Validates a connection string by opening a temporary single-client pool,
 * running SELECT 1, then tearing it down.  Does NOT affect the live pool.
 * Throws if the connection cannot be established.
 */
export async function testDatabaseConnection(connectionString: string): Promise<void> {
  const testPool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
  });
  try {
    const client = await testPool.connect();
    await client.query("SELECT 1");
    client.release();
  } finally {
    await testPool.end();
  }
}

export * from "./schema";
