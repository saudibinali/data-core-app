/**
 * Phase 3 — Parse multipart HR import XLSX upload.
 */
import type { Request, Response, NextFunction } from "express";
import Busboy from "busboy";
import { UPLOAD_LIMITS } from "./workforce/upload-config";

const MAX_BYTES = Math.min(UPLOAD_LIMITS.hrDocumentBytes * 2, 25 * 1024 * 1024);
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export interface ParsedHrImportUpload {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
  templateKey?: string;
  importType?: string;
}

declare global {
  namespace Express {
    interface Request {
      hrImportUpload?: ParsedHrImportUpload;
    }
  }
}

export function parseHrImportUpload(req: Request, res: Response, next: NextFunction): void {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    return;
  }

  const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES, files: 1 } });
  let fileBuffer: Buffer | null = null;
  let originalFileName = "";
  let mimeType = "";
  let templateKey = "";
  let importType = "";
  let fileReceived = false;
  let rejected = false;

  busboy.on("field", (name, val) => {
    if (name === "templateKey") templateKey = val;
    if (name === "importType") importType = val;
  });

  busboy.on("file", (fieldname, file, info) => {
    if (fieldname !== "file") {
      file.resume();
      return;
    }
    if (fileReceived) {
      rejected = true;
      file.resume();
      return;
    }
    fileReceived = true;
    originalFileName = info.filename ?? "import.xlsx";
    mimeType = info.mimeType ?? "application/octet-stream";
    const extOk = /\.xlsx$/i.test(originalFileName);
    if (!extOk && !ALLOWED_MIME.has(mimeType)) {
      rejected = true;
      file.resume();
      return;
    }
    const chunks: Buffer[] = [];
    file.on("data", (chunk: Buffer) => chunks.push(chunk));
    file.on("limit", () => {
      rejected = true;
    });
    file.on("end", () => {
      if (!rejected) fileBuffer = Buffer.concat(chunks);
    });
  });

  busboy.on("error", () => {
    if (!res.headersSent) res.status(400).json({ error: "Upload parse failed" });
  });

  busboy.on("finish", () => {
    if (rejected) {
      res.status(413).json({ error: "File too large or invalid type" });
      return;
    }
    if (!fileBuffer) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    req.hrImportUpload = {
      buffer: fileBuffer,
      originalFileName,
      mimeType,
      templateKey: templateKey || undefined,
      importType: importType || undefined,
    };
    next();
  });

  req.pipe(busboy);
}
