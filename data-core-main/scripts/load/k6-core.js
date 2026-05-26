/**
 * F9 acceptance — k6 load smoke for core read paths.
 *
 * Usage:
 *   k6 run -e BASE_URL=http://localhost:8080 -e AUTH_TOKEN=<jwt> scripts/load/k6-core.js
 *
 * Targets (plan): 500 VUs, p95 < 500ms on healthz + hr employees list.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const hrListDuration = new Trend("hr_employees_list_duration");
const healthDuration = new Trend("healthz_duration");

export const options = {
  stages: [
    { duration: "1m", target: 50 },
    { duration: "3m", target: Number(__ENV.K6_VUS ?? 200) },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    checks: ["rate>0.99"],
  },
};

const base = __ENV.BASE_URL ?? "http://localhost:8080";
const token = __ENV.AUTH_TOKEN ?? "";

export default function () {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const h = http.get(`${base}/api/healthz`, { tags: { name: "healthz" } });
  healthDuration.add(h.timings.duration);
  check(h, { "healthz 200": (r) => r.status === 200 });

  if (token) {
    const e = http.get(`${base}/api/hr/employees?limit=50`, {
      headers,
      tags: { name: "hr_employees" },
    });
    hrListDuration.add(e.timings.duration);
    check(e, { "employees 200": (r) => r.status === 200 });
  }

  sleep(1);
}
