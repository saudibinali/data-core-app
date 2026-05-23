const counters: Record<string, number> = {
  "legacy.route_hit": 0,
  "legacy.adapter_write": 0,
  "legacy.adapter_read": 0,
  "legacy.shadow_mismatch": 0,
  "legacy.write_blocked": 0,
  "approval.inbox_query": 0,
  "org.traversal_cache_hit": 0,
  "org.traversal_cache_miss": 0,
  "employee_file.aggregate": 0,
  "timeline.query": 0,
  "startup.diagnostics": 0,
};

export function incrementRuntimeMetric(key: string, by = 1): void {
  counters[key] = (counters[key] ?? 0) + by;
}

export function getRuntimeMetrics(): Readonly<Record<string, number>> {
  return { ...counters };
}

export function resetRuntimeMetrics(): void {
  for (const k of Object.keys(counters)) counters[k] = 0;
}

export type StartupDiagnostic = {
  component: string;
  status: "ok" | "warn" | "error";
  message: string;
  at: string;
};

const startupDiagnostics: StartupDiagnostic[] = [];

export function pushStartupDiagnostic(entry: Omit<StartupDiagnostic, "at">): void {
  startupDiagnostics.push({ ...entry, at: new Date().toISOString() });
  incrementRuntimeMetric("startup.diagnostics");
}

export function getStartupDiagnostics(): readonly StartupDiagnostic[] {
  return startupDiagnostics;
}
