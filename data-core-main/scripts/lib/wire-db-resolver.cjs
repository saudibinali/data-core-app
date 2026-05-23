#!/usr/bin/env node
/**
 * One-time batch updater: wire scripts/*.cjs to unified db resolver.
 * Safe to re-run; skips files already updated.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const scriptsDir = path.join(__dirname, "..");
const resolverBlock = `const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

let DATABASE_URL;
try {
  DATABASE_URL = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
`;

const patterns = [
  /const DATABASE_URL = process\.env\.DATABASE_URL;\s*\nif \(!DATABASE_URL\) \{[^}]+\}\s*\n/g,
  /const url = process\.env\.DATABASE_URL;\s*\n\s*if \(!url\) \{[^}]+\}\s*\n/g,
  /const databaseUrl = process\.env\.DATABASE_URL;\s*\n\s*if \(!databaseUrl\) \{[^}]+\}\s*\n/g,
];

const skip = new Set(["lib/db-resolver.cjs", "fix-mojibake.cjs"]);

for (const name of fs.readdirSync(scriptsDir)) {
  if (!name.endsWith(".cjs") || skip.has(name)) continue;
  const filePath = path.join(scriptsDir, name);
  let src = fs.readFileSync(filePath, "utf8");
  if (src.includes("db-resolver.cjs")) continue;

  let updated = src;
  for (const pattern of patterns) {
    updated = updated.replace(pattern, resolverBlock);
  }

  if (updated !== src) {
    fs.writeFileSync(filePath, updated, "utf8");
    console.log("updated", name);
  }
}
