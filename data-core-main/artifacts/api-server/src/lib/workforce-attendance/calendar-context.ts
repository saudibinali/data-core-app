import { db } from "@workspace/db";
import { hrWorkCalendarsTable, hrCalendarHolidaysTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export async function getWorkspaceTimezone(workspaceId: number): Promise<string> {
  const [cal] = await db
    .select({ timezone: hrWorkCalendarsTable.timezone })
    .from(hrWorkCalendarsTable)
    .where(and(eq(hrWorkCalendarsTable.workspaceId, workspaceId), eq(hrWorkCalendarsTable.isDefault, true)))
    .limit(1);

  if (cal?.timezone) return cal.timezone;

  const [anyCal] = await db
    .select({ timezone: hrWorkCalendarsTable.timezone })
    .from(hrWorkCalendarsTable)
    .where(eq(hrWorkCalendarsTable.workspaceId, workspaceId))
    .limit(1);

  return anyCal?.timezone ?? "Asia/Riyadh";
}

export async function isHoliday(workspaceId: number, dateStr: string): Promise<boolean> {
  const calendars = await db
    .select({ id: hrWorkCalendarsTable.id })
    .from(hrWorkCalendarsTable)
    .where(eq(hrWorkCalendarsTable.workspaceId, workspaceId));

  if (calendars.length === 0) return false;

  const calIds = calendars.map((c) => c.id);
  for (const calId of calIds) {
    const [h] = await db
      .select({ id: hrCalendarHolidaysTable.id })
      .from(hrCalendarHolidaysTable)
      .where(
        and(eq(hrCalendarHolidaysTable.calendarId, calId), eq(hrCalendarHolidaysTable.date, dateStr)),
      )
      .limit(1);
    if (h) return true;
  }
  return false;
}

export function isWorkDay(dateStr: string, workDays: number[], timezone: string): boolean {
  const d = new Date(`${dateStr}T12:00:00`);
  let dow: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).formatToParts(d);
    const dayName = parts.find((p) => p.type === "weekday")?.value;
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    dow = map[dayName ?? "Mon"] ?? 1;
  } catch {
    dow = d.getUTCDay();
  }
  return workDays.includes(dow);
}
