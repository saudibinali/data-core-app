/**
 * F10.1 — Optional Redis cache (REDIS_URL). Falls back to in-memory Map when unset.
 */
import { logger } from "../logger";

type MemoryEntry = { value: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();

let redisClient: {
  get: (k: string) => Promise<string | null>;
  setEx: (k: string, ttl: number, v: string) => Promise<unknown>;
  ping: () => Promise<string>;
} | null = null;

let redisInitAttempted = false;

export function isRedisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

async function getRedis() {
  if (!isRedisEnabled()) return null;
  if (redisClient) return redisClient;
  if (redisInitAttempted) return null;
  redisInitAttempted = true;
  try {
    const { createClient } = await import("redis");
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => logger.warn({ err }, "Redis client error"));
    await client.connect();
    redisClient = client;
    logger.info("Redis connected");
    return redisClient;
  } catch (err) {
    logger.warn({ err }, "Redis unavailable — using in-memory cache fallback");
    return null;
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  const redis = await getRedis();
  if (redis) {
    return redis.get(key);
  }
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

export async function cacheSet(key: string, value: string, ttlSec: number): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    await redis.setEx(key, ttlSec, value);
    return;
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

export async function pingRedis(): Promise<{ ok: boolean; latencyMs?: number }> {
  if (!isRedisEnabled()) return { ok: false };
  const redis = await getRedis();
  if (!redis) return { ok: false };
  const start = Date.now();
  await redis.ping();
  return { ok: true, latencyMs: Date.now() - start };
}
