import type { Request, Response, NextFunction } from "express";
import Busboy from "busboy";
import {
  HR_DOCUMENT_ALLOWED_MIMES,
  payloadTooLargeResponse,
  UPLOAD_LIMITS,
} from "./upload-config";

export interface ParsedHrDocumentUpload {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
}

declare global {
  namespace Express {
    interface Request {
      hrDocumentUpload?: ParsedHrDocumentUpload;
    }
  }
}

const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp)$/i;

export function parseHrDocumentUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    return;
  }

  const maxBytes = UPLOAD_LIMITS.hrDocumentBytes;
  let responded = false;

  const busboy = Busboy({
    headers: req.headers,
    limits: { fileSize: maxBytes, files: 1, fields: 20 },
  });

  let fileBuffer: Buffer | null = null;
  let fileName = "";
  let mimeType = "";

  busboy.on("file", (_field, stream, info) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("limit", () => {
      if (responded) return;
      responded = true;
      res.status(413).json(payloadTooLargeResponse(maxBytes, "HR document"));
    });
    stream.on("end", () => {
      fileBuffer = Buffer.concat(chunks);
      fileName = info.filename ?? "document";
      mimeType = info.mimeType ?? "application/octet-stream";
    });
  });

  busboy.on("finish", () => {
    if (responded) return;
    if (!fileBuffer || fileBuffer.length === 0) {
      res.status(400).json({ error: "File is required" });
      return;
    }
    const mimeOk = (HR_DOCUMENT_ALLOWED_MIMES as readonly string[]).includes(mimeType);
    const extOk = ALLOWED_EXT.test(fileName);
    if (!mimeOk && !extOk) {
      res.status(400).json({
        error: "Unsupported file type",
        allowed: [...HR_DOCUMENT_ALLOWED_MIMES],
      });
      return;
    }
    req.hrDocumentUpload = {
      buffer: fileBuffer,
      originalFileName: fileName,
      mimeType: mimeOk ? mimeType : "application/pdf",
    };
    next();
  });

  busboy.on("error", () => {
    if (responded) return;
    responded = true;
    res.status(400).json({ error: "Failed to parse upload" });
  });

  req.pipe(busboy);
}
