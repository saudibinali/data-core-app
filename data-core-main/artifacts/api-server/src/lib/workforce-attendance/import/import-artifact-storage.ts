import fs from "node:fs/promises";
import path from "node:path";

function getImportRoot(): string {
  return process.env.IMPORT_ARTIFACT_DIR ?? path.join(process.cwd(), "data", "import-artifacts");
}

export async function storeImportFile(
  workspaceId: number,
  batchId: number,
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  const dir = path.join(getImportRoot(), `ws-${workspaceId}`, String(batchId));
  await fs.mkdir(dir, { recursive: true });
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, safe);
  await fs.writeFile(filePath, buffer);
  return `local://imports/ws-${workspaceId}/${batchId}/${safe}`;
}

export async function readImportFile(storageKey: string): Promise<Buffer> {
  if (!storageKey.startsWith("local://imports/")) {
    throw new Error("Unsupported import storage key");
  }
  const relative = storageKey.replace("local://imports/", "");
  return fs.readFile(path.join(getImportRoot(), relative));
}
