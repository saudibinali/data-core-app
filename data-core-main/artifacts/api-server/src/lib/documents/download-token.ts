import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../middlewares/requireAuth";

const DOWNLOAD_TTL_SEC = Number(process.env.DOCUMENT_DOWNLOAD_TTL_SEC ?? 900);

export type DocumentDownloadPayload = {
  documentId: number;
  versionId: number;
  workspaceId: number;
  userId: number;
};

export function issueDocumentDownloadToken(payload: DocumentDownloadPayload): string {
  return jwt.sign(
    {
      typ: "doc_dl",
      documentId: payload.documentId,
      versionId: payload.versionId,
      workspaceId: payload.workspaceId,
      userId: payload.userId,
    },
    JWT_SECRET,
    { expiresIn: DOWNLOAD_TTL_SEC },
  );
}

export function verifyDocumentDownloadToken(token: string): DocumentDownloadPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (decoded.typ !== "doc_dl") return null;
    if (
      typeof decoded.documentId !== "number" ||
      typeof decoded.versionId !== "number" ||
      typeof decoded.workspaceId !== "number" ||
      typeof decoded.userId !== "number"
    ) {
      return null;
    }
    return {
      documentId: decoded.documentId,
      versionId: decoded.versionId,
      workspaceId: decoded.workspaceId,
      userId: decoded.userId,
    };
  } catch {
    return null;
  }
}

export function getDownloadTtlSec(): number {
  return DOWNLOAD_TTL_SEC;
}
