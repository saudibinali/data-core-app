/**
 * Fix UTF-8 mojibake (Windows-1252 misread) across source trees.
 * All forbidden/replacement literals use Unicode escapes (no mojibake in this file).
 *
 * Usage: node scripts/fix-mojibake.cjs [--check]
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const SCAN_ROOTS = [
  "artifacts/ops-platform/src",
  "artifacts/api-server/src",
  "lib/db/src",
  "lib/db/scripts",
  "lib/api-client-react/src",
].map((p) => path.join(ROOT, p));

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".vite",
  "coverage",
]);

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".sql",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".cjs",
  ".mjs",
]);

/** Order matters: longer sequences first. */
const REPLACEMENTS = [
  ["\u00E2\u20AC\u2122", "'"],
  ["\u00E2\u20AC\u02DC", "'"],
  ["\u00E2\u20AC\u0153", '"'],
  ["\u00E2\u20AC\u009D", '"'],
  ["\u00E2\u20AC\u00A6", "..."],
  ["\u00E2\u20AC\u201C", "-"],
  ["\u00E2\u20AC\u201D", "-"],
  ["\u00E2\u201D\u20AC", "-"],
  ["\u00C2\u00B7", " - "],
  ["\u00C2\u00A0", " "],
  ["\uFFFD", ""],
  ["\u2014", "-"],
  ["\u2013", "-"],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201C", '"'],
  ["\u201D", '"'],
  ["\u2026", "..."],
];

/** Forbidden mojibake tokens (must match guard test). */
const FORBIDDEN = [
  "\u00E2\u20AC\u2122",
  "\u00E2\u20AC\u0153",
  "\u00E2\u20AC\u009D",
  "\u00E2\u20AC\u00A6",
  "\u00E2\u20AC\u201C",
  "\u00E2\u20AC\u201D",
  "\u00E2\u20AC\u02DC",
  "\u00E2\u20AC",
  "\u00C2",
  "\uFFFD",
];

function walk(dir, files) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(path.extname(ent.name))) files.push(full);
  }
}

function fixContent(text) {
  let out = text;
  for (const [from, to] of REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}

function hasForbidden(text) {
  return FORBIDDEN.some((t) => text.includes(t));
}

const checkOnly = process.argv.includes("--check");
const files = [];
for (const root of SCAN_ROOTS) walk(root, files);

const changed = [];
const remaining = [];

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  if (!hasForbidden(before) && !before.includes("\u2014") && !before.includes("\u2026")) {
    continue;
  }

  const after = fixContent(before);
  if (after !== before) {
    if (!checkOnly) fs.writeFileSync(file, after, "utf8");
    changed.push(path.relative(ROOT, file));
  }
  if (hasForbidden(after)) {
    remaining.push(path.relative(ROOT, file));
  }
}

if (!checkOnly) {
  console.log(`Fixed ${changed.length} files`);
  if (changed.length) changed.forEach((f) => console.log("  " + f));
}
if (remaining.length) {
  console.error(`Remaining mojibake in ${remaining.length} files:`);
  remaining.slice(0, 30).forEach((f) => console.error("  " + f));
  process.exitCode = 1;
} else {
  console.log("No forbidden mojibake tokens remain in scanned trees.");
}
