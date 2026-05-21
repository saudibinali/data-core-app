/**
 * Platform password policy from security settings.
 */
import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface PlatformPasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireSpecial: boolean;
  requireNumber: boolean;
}

const DEFAULT_POLICY: PlatformPasswordPolicy = {
  minLength: 8,
  requireUppercase: false,
  requireSpecial: false,
  requireNumber: true,
};

async function readSecuritySettings(): Promise<Record<string, unknown>> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.category, "security"))
    .limit(1);
  return (row?.value ?? {}) as Record<string, unknown>;
}

export async function loadPlatformPasswordPolicy(): Promise<PlatformPasswordPolicy> {
  try {
    const sec = await readSecuritySettings();
    return {
      minLength: Math.max(
        6,
        Number(sec.password_min_length ?? DEFAULT_POLICY.minLength) || 8,
      ),
      requireUppercase: Boolean(
        sec.password_require_uppercase ?? DEFAULT_POLICY.requireUppercase,
      ),
      requireSpecial: Boolean(
        sec.password_require_special ?? DEFAULT_POLICY.requireSpecial,
      ),
      requireNumber: Boolean(
        sec.password_require_number ?? DEFAULT_POLICY.requireNumber,
      ),
    };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function validatePasswordAgainstPolicy(
  password: string,
  policy: PlatformPasswordPolicy,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const p = String(password);

  if (p.length < policy.minLength) {
    errors.push(`PASSWORD_MIN_LENGTH_${policy.minLength}`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(p)) {
    errors.push("PASSWORD_REQUIRES_UPPERCASE");
  }
  if (policy.requireNumber && !/[0-9]/.test(p)) {
    errors.push("PASSWORD_REQUIRES_NUMBER");
  }
  if (policy.requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(p)) {
    errors.push("PASSWORD_REQUIRES_SPECIAL");
  }

  return { valid: errors.length === 0, errors };
}

export function passwordPolicyErrorMessage(
  errors: string[],
  policy: PlatformPasswordPolicy,
): string {
  if (errors.includes("PASSWORD_REQUIRES_UPPERCASE")) {
    return "Password must include at least one uppercase letter.";
  }
  if (errors.includes("PASSWORD_REQUIRES_NUMBER")) {
    return "Password must include at least one number.";
  }
  if (errors.includes("PASSWORD_REQUIRES_SPECIAL")) {
    return "Password must include at least one special character.";
  }
  if (errors.some((e) => e.startsWith("PASSWORD_MIN_LENGTH"))) {
    return `Password must be at least ${policy.minLength} characters.`;
  }
  return "Password does not meet platform security requirements.";
}
