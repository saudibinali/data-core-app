import { describe, expect, it } from "vitest";
import { formatPrometheusMetrics, isMetricsEndpointEnabled } from "../prometheus-metrics";

describe("prometheus-metrics", () => {
  it("formats counter lines", () => {
    const text = formatPrometheusMetrics({ test_metric: 3 });
    expect(text).toContain('platform_runtime_counter{metric="test_metric"} 3');
    expect(text).toContain("# TYPE platform_runtime_counter counter");
  });

  it("respects METRICS_ENABLED=false", () => {
    const prev = process.env.METRICS_ENABLED;
    process.env.METRICS_ENABLED = "false";
    expect(isMetricsEndpointEnabled()).toBe(false);
    process.env.METRICS_ENABLED = prev;
  });
});
