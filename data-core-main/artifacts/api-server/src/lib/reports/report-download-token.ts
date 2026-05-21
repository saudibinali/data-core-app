import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../middlewares/requireAuth";

const TTL_SEC = Number(process.env.REPORT_DOWNLOAD_TTL_SEC ?? 900);

export type ReportDownloadPayload = {
  generatedReportId: number;
  workspaceId: number;
  userId: number;
};

export function issueReportDownloadToken(payload: ReportDownloadPayload): string {
  return jwt.sign(
    { typ: "report_dl", ...payload },
    JWT_SECRET,
    { expiresIn: TTL_SEC },
  );
}

export function verifyReportDownloadToken(token: string): ReportDownloadPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (decoded.typ !== "report_dl") return null;
    if (
      typeof decoded.generatedReportId !== "number" ||
      typeof decoded.workspaceId !== "number" ||
      typeof decoded.userId !== "number"
    ) {
      return null;
    }
    return {
      generatedReportId: decoded.generatedReportId,
      workspaceId: decoded.workspaceId,
      userId: decoded.userId,
    };
  } catch {
    return null;
  }
}
