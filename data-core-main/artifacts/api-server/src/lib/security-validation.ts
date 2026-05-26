/**
 * F1.6 — Zod validation for high-risk write endpoints.
 */

import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const AuthLoginBody = z.object({
  employeeNumber: z.string().trim().min(1, "employeeNumber is required"),
  password: z.string().min(1, "password is required"),
});

export const AdminCreateGeneralUserBody = z.object({
  firstName: z.string().trim().min(1, "firstName is required"),
  lastName: z.string().trim().min(1, "lastName is required"),
  email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  password: z.string().min(8, "password must be at least 8 characters"),
  role: z.enum(["admin", "manager", "member"]).optional().default("member"),
  departmentIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  position: z.string().nullish(),
  mustResetPassword: z.boolean().optional().default(false),
  customRoleId: z.coerce.number().int().positive().nullish(),
  accountType: z.string().optional(),
});

export const AdminCreateUserFromEmployeeBody = z.object({
  employeeNumber: z.string().trim().min(1).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  password: z.string().min(8, "password must be at least 8 characters"),
  role: z.enum(["admin", "manager", "member"]).optional().default("member"),
  customRoleId: z.coerce.number().int().positive().nullish(),
  mustResetPassword: z.boolean().optional().default(false),
}).refine(
  (data) => Boolean(data.employeeNumber?.trim() || data.employeeId),
  { message: "employeeNumber or employeeId is required" },
);

export const HrEmployeeCreateBody = z.object({
  fullName: z.string().trim().min(1, "fullName is required"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phoneNumber: z.string().optional(),
  employeeNumber: z.string().optional(),
  avatarUrl: z.string().optional(),
  status: z.string().optional(),
  userId: z.coerce.number().int().positive().optional(),
}).passthrough();

export const SubmitLeaveRequestBody = z.object({
  leaveType: z.string().trim().min(1, "leaveType is required"),
  startDate: z.string().regex(ISO_DATE, "startDate must be YYYY-MM-DD"),
  endDate: z.string().regex(ISO_DATE, "endDate must be YYYY-MM-DD"),
  employeeNote: z.string().max(1000).optional(),
  leavePolicyId: z.coerce.number().int().positive().optional(),
  attachmentUrls: z.array(z.string()).optional(),
});

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}
