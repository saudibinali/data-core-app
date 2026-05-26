import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../middlewares/requireAuth";

const TTL_SEC = Number(process.env.PAYROLL_EXPORT_DOWNLOAD_TTL_SEC ?? 900);

export type PayrollExportDownloadPayload = {
  workspaceId: number;
  userId: number;
  runId: number;
  exportType: "gl_journal" | "cost_center" | "bank_metadata" | "bank_wps";
};

export function issuePayrollExportDownloadToken(
  payload: PayrollExportDownloadPayload,
): string {
  return jwt.sign(
    {
      typ: "payroll_export_dl",
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      runId: payload.runId,
      exportType: payload.exportType,
    },
    JWT_SECRET,
    { expiresIn: TTL_SEC },
  );
}

export function verifyPayrollExportDownloadToken(
  token: string,
): PayrollExportDownloadPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (decoded.typ !== "payroll_export_dl") return null;
    if (
      typeof decoded.workspaceId !== "number" ||
      typeof decoded.userId !== "number" ||
      typeof decoded.runId !== "number" ||
      typeof decoded.exportType !== "string"
    ) {
      return null;
    }
    const exportType = decoded.exportType as PayrollExportDownloadPayload["exportType"];
    if (!["gl_journal", "cost_center", "bank_metadata", "bank_wps"].includes(exportType)) return null;
    return {
      workspaceId: decoded.workspaceId,
      userId: decoded.userId,
      runId: decoded.runId,
      exportType,
    };
  } catch {
    return null;
  }
}
