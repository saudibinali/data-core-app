/**
 * F10.2 — Process role: embedded (default SME), api (HTTP only), worker (background only).
 */
export type RuntimeMode = "embedded" | "api" | "worker";

export function getRuntimeMode(): RuntimeMode {
  const raw = (process.env.WORKER_MODE ?? process.env.RUNTIME_MODE ?? "embedded").toLowerCase();
  if (raw === "api" || raw === "http") return "api";
  if (raw === "worker" || raw === "standalone") return "worker";
  return "embedded";
}

export function shouldStartBackgroundWorkers(): boolean {
  const mode = getRuntimeMode();
  return mode === "embedded" || mode === "worker";
}

export function shouldStartHttpServer(): boolean {
  const mode = getRuntimeMode();
  return mode === "embedded" || mode === "api";
}
