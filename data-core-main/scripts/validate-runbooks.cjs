#!/usr/bin/env node
/**
 * F0.4 — Ensures required ops runbooks exist.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "docs/runbooks/README.md",
  "docs/runbooks/deploy.md",
  "docs/runbooks/rollback.md",
  "docs/runbooks/incident-db-migration-failed.md",
];

const missing = required.filter((rel) => !fs.existsSync(path.join(root, rel)));
const report = {
  ok: missing.length === 0,
  requiredCount: required.length,
  missing,
  checkedAt: new Date().toISOString(),
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
