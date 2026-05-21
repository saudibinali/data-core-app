import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../middlewares/requireAuth";

const TTL_SEC = Number(process.env.PAYSLIP_DOWNLOAD_TTL_SEC ?? 900);

export type PayslipDownloadPayload = {
  payslipId: number;
  workspaceId: number;
  userId: number;
};

export function issuePayslipDownloadToken(payload: PayslipDownloadPayload): string {
  return jwt.sign(
    {
      typ: "payslip_dl",
      payslipId: payload.payslipId,
      workspaceId: payload.workspaceId,
      userId: payload.userId,
    },
    JWT_SECRET,
    { expiresIn: TTL_SEC },
  );
}

export function verifyPayslipDownloadToken(token: string): PayslipDownloadPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (decoded.typ !== "payslip_dl") return null;
    if (
      typeof decoded.payslipId !== "number" ||
      typeof decoded.workspaceId !== "number" ||
      typeof decoded.userId !== "number"
    ) {
      return null;
    }
    return {
      payslipId: decoded.payslipId,
      workspaceId: decoded.workspaceId,
      userId: decoded.userId,
    };
  } catch {
    return null;
  }
}
