import { CronExpressionParser } from "cron-parser";

export function computeNextRunAt(cron: string, timezone: string, from = new Date()): Date {
  const interval = CronExpressionParser.parse(cron, {
    currentDate: from,
    tz: timezone || "UTC",
  });
  return interval.next().toDate();
}
