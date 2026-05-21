/**
 * P20-C — Parse multipart attendance import file upload
 */
import type { Request, Response, NextFunction } from "express";
import Busboy from "busboy";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
]);

export interface ParsedAttendanceImportUpload {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      attendanceImportUpload?: ParsedAttendanceImportUpload;
    }
  }
}

export function parseAttendanceImportUpload(
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
    originalFileName = info.filename ?? "attendance.xlsx";
    mimeType = info.mimeType ?? "application/octet-stream";

    const extOk = /\.(xlsx|xls|csv)$/i.test(originalFileName);
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
      res.status(400).json({ error: "Upload must be a single XLSX or CSV file (max 10MB)" });
      return;
    }
    req.attendanceImportUpload = { buffer: fileBuffer, originalFileName, mimeType };
    next();
  });

  req.pipe(busboy);
}
