#!/usr/bin/env node
/**
 * F3.2 — OpenAPI vs Express route drift gate.
 *
 * Fails when api-server exposes a route not documented in openapi.yaml
 * and not listed in scripts/openapi-route-allowlist.json.
 *
 * Usage:
 *   node scripts/openapi-route-diff.cjs
 *   node scripts/openapi-route-diff.cjs --update-allowlist
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const openapiPath = path.join(root, "lib/api-spec/openapi.yaml");
const routesDir = path.join(root, "artifacts/api-server/src/routes");
const allowlistPath = path.join(__dirname, "openapi-route-allowlist.json");

/** Batch 3A — must exist in OpenAPI (CI sanity). */
const REQUIRED_IN_SPEC = [
  "POST /auth/login",
  "POST /auth/logout",
  "GET /auth/me",
  "POST /auth/change-password",
  "PATCH /auth/me/profile",
  "PATCH /auth/me/email",
  "POST /auth/reset-password",
];

function normalizeExpressPath(p) {
  return p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function loadSpecPaths() {
  const yaml = fs.readFileSync(openapiPath, "utf8");
  const paths = new Set();
  for (const line of yaml.split("\n")) {
    const m = line.match(/^  (\/[^\s:]+):\s*$/);
    if (m) paths.add(normalizeExpressPath(m[1]));
  }
  return paths;
}

function loadCodeRoutes() {
  const routes = new Set();
  const files = fs.readdirSync(routesDir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  const re = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;

  for (const file of files) {
    const content = fs.readFileSync(path.join(routesDir, file), "utf8");
    let m;
    while ((m = re.exec(content)) !== null) {
      const method = m[1].toUpperCase();
      const routePath = normalizeExpressPath(m[2]);
      routes.add(`${method} ${routePath}`);
    }
  }
  return routes;
}

function loadAllowlist() {
  if (!fs.existsSync(allowlistPath)) return new Set();
  const data = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
  return new Set((data.routes ?? []).map((r) => r.replace(/\s+/g, " ").trim()));
}

function saveAllowlist(routes) {
  const sorted = [...routes].sort();
  fs.writeFileSync(
    allowlistPath,
    JSON.stringify(
      {
        description:
          "Express routes not yet in OpenAPI. Shrink this list as F3 batches land. Do not add new routes here — document them in openapi.yaml instead.",
        routes: sorted,
      },
      null,
      2,
    ) + "\n",
  );
}

function main() {
  const updateAllowlist = process.argv.includes("--update-allowlist");
  const specPaths = loadSpecPaths();
  const codeRoutes = loadCodeRoutes();
  const allowlist = loadAllowlist();

  const specRouteKeys = new Set();
  for (const p of specPaths) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      specRouteKeys.add(`${method} ${p}`);
    }
  }

  const documented = new Set();
  for (const key of codeRoutes) {
    const pathOnly = key.slice(key.indexOf(" ") + 1);
    if (specPaths.has(pathOnly)) {
      documented.add(key);
    }
  }

  const undocumented = [...codeRoutes].filter((k) => {
    const pathOnly = k.slice(k.indexOf(" ") + 1);
    return !specPaths.has(pathOnly);
  });

  const missingRequired = REQUIRED_IN_SPEC.filter((r) => {
    const pathOnly = r.slice(r.indexOf(" ") + 1);
    return !specPaths.has(pathOnly);
  });

  if (updateAllowlist) {
    saveAllowlist(undocumented);
    console.log(JSON.stringify({ ok: true, updated: undocumented.length, allowlistPath }, null, 2));
    process.exit(0);
  }

  const notAllowlisted = undocumented.filter((r) => !allowlist.has(r));
  const staleAllowlist = [...allowlist].filter((r) => !undocumented.includes(r));

  const issues = [];
  if (missingRequired.length) {
    issues.push({ code: "REQUIRED_PATHS_MISSING_FROM_SPEC", routes: missingRequired });
  }
  if (notAllowlisted.length) {
    issues.push({ code: "UNDOCUMENTED_ROUTE", routes: notAllowlisted.slice(0, 50), total: notAllowlisted.length });
  }
  if (staleAllowlist.length) {
    issues.push({ code: "STALE_ALLOWLIST", routes: staleAllowlist.slice(0, 20), total: staleAllowlist.length });
  }

  const report = {
    ok: issues.length === 0,
    specPathCount: specPaths.size,
    codeRouteCount: codeRoutes.size,
    documentedRouteCount: documented.size,
    undocumentedCount: undocumented.length,
    allowlistCount: allowlist.size,
    issues,
    checkedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
