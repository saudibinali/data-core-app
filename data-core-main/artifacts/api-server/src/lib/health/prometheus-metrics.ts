import { getRuntimeMetrics } from "../workforce/stabilization/observability-metrics";

export function isMetricsEndpointEnabled(): boolean {
  const v = process.env.METRICS_ENABLED;
  if (v === "0" || v === "false") return false;
  return true;
}

/** Prometheus text exposition format (in-process counters). */
export function formatPrometheusMetrics(extra?: Record<string, number>): string {
  const lines: string[] = [
    "# HELP platform_runtime_counter In-process counters (reset on restart)",
    "# TYPE platform_runtime_counter counter",
  ];
  const merged = { ...getRuntimeMetrics(), ...extra };
  for (const [key, value] of Object.entries(merged)) {
    const safe = key.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`platform_runtime_counter{metric="${safe}"} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}
