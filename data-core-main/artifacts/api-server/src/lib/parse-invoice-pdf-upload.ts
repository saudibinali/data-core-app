/**
 * @phase P15-C - Parse multipart PDF upload (single file field "file")
 */

import type { Request, Response, NextFunction } from "express";
import Busboy from "busboy";
import { INVOICE_PDF_MAX_BYTES, INVOICE_PDF_MIME } from "./invoice-document-storage";

export interface ParsedInvoicePdfUpload {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      invoicePdfUpload?: ParsedInvoicePdfUpload;
    }
  }
}

const ALLOWED_EXT = /\.pdf$/i;

export function parseInvoicePdfUpload(
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
    limits: { fileSize: INVOICE_PDF_MAX_BYTES, files: 1 },
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
    originalFileName = info.filename ?? "invoice.pdf";
    mimeType = info.mimeType ?? INVOICE_PDF_MIME;

    if (!ALLOWED_EXT.test(originalFileName)) {
      rejected = true;
      file.resume();
      return;
    }
    if (mimeType !== INVOICE_PDF_MIME) {
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
      if (!rejected) {
        fileBuffer = Buffer.concat(chunks);
      }
    });
  });

  busboy.on("error", () => {
    if (!res.headersSent) {
      res.status(400).json({ error: "Invalid multipart upload" });
    }
  });

  busboy.on("finish", () => {
    if (res.headersSent) return;
    if (rejected || !fileBuffer || !fileReceived) {
      res.status(400).json({
        error: "Upload must be a single PDF file (application/pdf, .pdf extension, max 10MB)",
      });
      return;
    }
    req.invoicePdfUpload = {
      buffer: fileBuffer,
      originalFileName,
      mimeType: INVOICE_PDF_MIME,
    };
    next();
  });

  req.pipe(busboy);
}
