import { db, employeesTable } from "@workspace/db";
import { sql, eq, and, ne } from "drizzle-orm";

/**
 * Atomically generates the next employee number for a workspace.
 *
 * Uses an UPSERT so generation is always race-condition-safe.
 */
export async function generateEmployeeNumber(workspaceId: number): Promise<string> {
  const result = await db.execute(
    sql`INSERT INTO hr_workspace_counters (workspace_id, counter_name, current_value)
        VALUES (
          ${workspaceId},
          'employee_number',
          GREATEST(
            (SELECT COALESCE(
               MAX(CASE WHEN employee_number ~ '^[0-9]+$' THEN employee_number::INTEGER ELSE 0 END),
               1000
             ) + 1
             FROM employees WHERE workspace_id = ${workspaceId}),
            1001
          )
        )
        ON CONFLICT (workspace_id, counter_name)
        DO UPDATE SET current_value = GREATEST(
          hr_workspace_counters.current_value + 1,
          (SELECT COALESCE(
             MAX(CASE WHEN employee_number ~ '^[0-9]+$' THEN employee_number::INTEGER ELSE 0 END),
             0
           ) + 1
           FROM employees WHERE workspace_id = ${workspaceId})
        )
        RETURNING current_value`,
  );
  return String((result.rows[0] as { current_value: number }).current_value);
}

/**
 * Validates a manually-supplied employee number for a workspace.
 * Returns null if valid, or an error message string if invalid.
 */
export async function validateManualEmployeeNumber(
  workspaceId: number,
  employeeNumber: string,
  excludeEmployeeId?: number,
): Promise<string | null> {
  if (!employeeNumber?.trim()) return "Employee number is required";

  const conditions = [
    eq(employeesTable.workspaceId, workspaceId),
    eq(employeesTable.employeeNumber, employeeNumber.trim()),
  ];
  if (excludeEmployeeId) conditions.push(ne(employeesTable.id, excludeEmployeeId));

  const [existing] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(...conditions));

  if (existing) return `Employee number "${employeeNumber}" is already in use`;
  return null;
}
