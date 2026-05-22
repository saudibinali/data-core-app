import type { Request, Response, NextFunction } from "express";
import Busboy from "busboy";
import {
  CONTRACT_PDF_MAX_BYTES,
  CONTRACT_PDF_MIME,
} from "./contract-document-storage";

export interface ParsedContractPdfUpload {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
}

declare global {
  namespace Express {
    interface Request {
      contractPdfUpload?: ParsedContractPdfUpload;
    }
  }
}

const ALLOWED_EXT = /\.pdf$/i;

export function parseContractPdfUpload(
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
    limits: { fileSize: CONTRACT_PDF_MAX_BYTES, files: 1 },
  });

  let fileBuffer: Buffer | null = null;
  let fileName = "";
  let mimeType = "";

  busboy.on("file", (_field, stream, info) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("limit", () => {
      res.status(400).json({ error: "PDF exceeds maximum allowed size" });
    });
    stream.on("end", () => {
      fileBuffer = Buffer.concat(chunks);
      fileName = info.filename ?? "contract.pdf";
      mimeType = info.mimeType ?? CONTRACT_PDF_MIME;
    });
  });

  busboy.on("finish", () => {
    if (!fileBuffer || fileBuffer.length === 0) {
      res.status(400).json({ error: "PDF file is required" });
      return;
    }
    if (!ALLOWED_EXT.test(fileName) && mimeType !== CONTRACT_PDF_MIME) {
      res.status(400).json({ error: "Only PDF files are allowed" });
      return;
    }
    req.contractPdfUpload = {
      buffer: fileBuffer,
      originalFileName: fileName,
      mimeType: mimeType || CONTRACT_PDF_MIME,
    };
    next();
  });

  busboy.on("error", () => {
    res.status(400).json({ error: "Failed to parse upload" });
  });

  req.pipe(busboy);
}
