/**
 * Parse multipart branding asset upload (field: file).
 */
import type { Request, Response, NextFunction } from "express";
import Busboy from "busboy";

export const BRANDING_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "svg",
  "webp",
  "gif",
  "ico",
  "bmp",
] as const;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/octet-stream",
]);

const LOGO_MAX_BYTES = 8 * 1024 * 1024;
const FAVICON_MAX_BYTES = 2 * 1024 * 1024;

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

function maxBytesForKind(kind: string | undefined): number {
  return kind === "favicon" ? FAVICON_MAX_BYTES : LOGO_MAX_BYTES;
}

function isAllowedFile(fileName: string, mimeType: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const extOk = (BRANDING_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
  if (extOk) return true;
  return ALLOWED_MIME.has(mimeType) && mimeType.startsWith("image/");
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

  const kind = String(req.query["kind"] ?? "logo");
  const maxBytes = maxBytesForKind(kind);

  const busboy = Busboy({
    headers: req.headers,
    limits: { fileSize: maxBytes, files: 1 },
  });

  let fileBuffer: Buffer | null = null;
  let originalFileName = "";
  let mimeType = "";
  let fileReceived = false;
  let rejected = false;
  let rejectReason = "Upload must be a single image file (png, jpg, jpeg, svg, webp, gif, ico, bmp).";

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

    if (!isAllowedFile(originalFileName, mimeType)) {
      rejected = true;
      rejectReason =
        "Unsupported image format. Allowed: png, jpg, jpeg, svg, webp, gif, ico, bmp.";
      file.resume();
      return;
    }

    const chunks: Buffer[] = [];
    file.on("data", (chunk: Buffer) => chunks.push(chunk));
    file.on("limit", () => {
      rejected = true;
      const mb = Math.round(maxBytes / (1024 * 1024));
      rejectReason = `File exceeds maximum size (${mb} MB).`;
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
      res.status(400).json({ error: rejectReason });
      return;
    }
    req.brandingUpload = { buffer: fileBuffer, originalFileName, mimeType };
    next();
  });

  req.pipe(busboy);
}
