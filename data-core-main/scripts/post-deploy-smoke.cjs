#!/usr/bin/env node
/**
 * Windows-friendly wrapper for post-deploy-smoke.sh (F0.3)
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

process.env.RUN_POST_DEPLOY_SMOKE = "1";
if (!process.env.RUN_LEAVE_SMOKE) process.env.RUN_LEAVE_SMOKE = "1";

const steps = [
  ["pnpm", ["run", "validate:migration-journal"]],
  ["pnpm", ["run", "db:migrate"]],
  ["pnpm", ["run", "validate:workforce"]],
  [
    "pnpm",
    [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/routes/__tests__/production-smoke.core.test.ts",
      "src/routes/__tests__/tenant-isolation.security.test.ts",
      "src/routes/__tests__/leave-canonical.smoke.test.ts",
      "src/routes/__tests__/leave-bridge.smoke.test.ts",
    ],
  ],
];

for (const [cmd, args] of steps) {
  console.log(`\n==> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("\n==> Post-deploy smoke passed");
