import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "v1:";

function getKey(): Buffer {
  const secret =
    process.env.COMMUNICATION_SECRET_KEY ??
    process.env.JWT_SECRET ??
    "dev-communication-key-change-in-production";
  return scryptSync(secret, "workspace-smtp-salt", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error("Unsupported secret format");
  }
  const parts = payload.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret");
  const iv = Buffer.from(parts[0]!, "base64");
  const tag = Buffer.from(parts[1]!, "base64");
  const data = Buffer.from(parts[2]!, "base64");
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
