/**
 * Parse multipart branding asset upload (field: file, max 2MB).
 */
import type { Request, Response, NextFunction } from "express";
import Busboy from "busboy";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

export interface ParsedBrandingUpload {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
}

declare global {
  namespace Express {
    interface Request {
      brandingUpload?: ParsedBrandingUpload;
    }
  }
}

export function parseBrandingUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    return;
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: { fileSize: MAX_BYTES, files: 1 },
  });

  let fileBuffer: Buffer | null = null;
  let originalFileName = "";
  let mimeType = "";
  let fileReceived = false;
  let rejected = false;

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
    originalFileName = info.filename ?? "asset.png";
    mimeType = info.mimeType ?? "application/octet-stream";

    const ext = originalFileName.split(".").pop()?.toLowerCase() ?? "";
    const extOk = ["png", "jpg", "jpeg", "svg", "webp", "ico"].includes(ext);
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
    if (!res.headersSent) res.status(400).json({ error: "Invalid multipart upload" });
  });

  busboy.on("finish", () => {
    if (res.headersSent) return;
    if (rejected || !fileBuffer || !fileReceived) {
      res.status(400).json({
        error: "Upload must be a single image (png, jpg, svg, webp, ico — max 2MB)",
      });
      return;
    }
    req.brandingUpload = { buffer: fileBuffer, originalFileName, mimeType };
    next();
  });

  req.pipe(busboy);
}
