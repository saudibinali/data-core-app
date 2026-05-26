import type { Request } from "express";
import { readIdempotencyKeyFromHeaders } from "./hr-provision-audit";

export function readProvisionIdempotencyKey(req: Request): string | null {
  return readIdempotencyKeyFromHeaders(req.headers as Record<string, string | string[] | undefined>);
}
