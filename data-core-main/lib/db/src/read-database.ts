/**
 * F10.3 — Optional read replica pool (DATABASE_READ_URL).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _readPool: pg.Pool | null = null;
let _readDb: DrizzleDb | null = null;

export function isReadReplicaConfigured(): boolean {
  return Boolean(process.env.DATABASE_READ_URL?.trim());
}

export function initializeReadDatabase(connectionString: string): void {
  if (_readPool) {
    void _readPool.end().catch(() => undefined);
  }
  _readPool = new Pool({ connectionString });
  _readDb = drizzle(_readPool, { schema });
}

export function getReadDb(): DrizzleDb {
  return _readDb as DrizzleDb;
}

export const readPool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    if (!_readPool) {
      throw new Error("Read replica pool not initialized — set DATABASE_READ_URL");
    }
    const value = Reflect.get(_readPool, prop, _readPool);
    return typeof value === "function" ? (value as Function).bind(_readPool) : value;
  },
});
