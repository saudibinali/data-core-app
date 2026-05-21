import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

function getArtifactRoot(): string {
  return process.env.REPORT_ARTIFACT_DIR ?? path.join(process.cwd(), "data", "report-artifacts");
}

/** Storage key: local://reports/ws-{workspaceId}/{reportId}/{fileName} */
export async function storeReportArtifact(
  workspaceId: number,
  reportId: number,
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  const dir = path.join(getArtifactRoot(), `ws-${workspaceId}`, String(reportId));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);
  return `local://reports/ws-${workspaceId}/${reportId}/${fileName}`;
}

export async function readReportArtifact(storageKey: string): Promise<Buffer> {
  if (!storageKey.startsWith("local://reports/")) {
    throw new Error("Unsupported storage key for local artifact reader");
  }
  const relative = storageKey.replace("local://reports/", "");
  const filePath = path.join(getArtifactRoot(), relative);
  return fs.readFile(filePath);
}

export function hashParameters(params: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 16);
}
