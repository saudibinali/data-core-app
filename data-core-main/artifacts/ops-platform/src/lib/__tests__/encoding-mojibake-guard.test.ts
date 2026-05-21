/**
 * Guard: forbid UTF-8 mojibake tokens in platform UI / API / db source trees.
 * Literals use Unicode escapes so this file stays clean.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../../../..");

const SCAN_ROOTS = [
  "artifacts/ops-platform/src",
  "artifacts/api-server/src",
  "lib/db/src",
  "lib/db/scripts",
  "lib/api-client-react/src",
].map((p) => path.join(REPO_ROOT, p));

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
]);

/** Must stay in sync with scripts/fix-mojibake.cjs FORBIDDEN list. */
const FORBIDDEN_TOKENS: { label: string; value: string }[] = [
  { label: "apostrophe-mojibake", value: "\u00E2\u20AC\u2122" },
  { label: "left-double-quote-mojibake", value: "\u00E2\u20AC\u0153" },
  { label: "right-double-quote-mojibake", value: "\u00E2\u20AC\u009D" },
  { label: "ellipsis-mojibake", value: "\u00E2\u20AC\u00A6" },
  { label: "en-dash-mojibake", value: "\u00E2\u20AC\u201C" },
  { label: "em-dash-mojibake", value: "\u00E2\u20AC\u201D" },
  { label: "left-single-quote-mojibake", value: "\u00E2\u20AC\u02DC" },
  { label: "partial-euro-mojibake", value: "\u00E2\u20AC" },
  { label: "stray-latin-capital-a-circumflex", value: "\u00C2" },
  { label: "replacement-character", value: "\uFFFD" },
];

const EXCLUDED_RELATIVE = new Set([
  "scripts/fix-mojibake.cjs",
  path.relative(REPO_ROOT, path.join(__dirname, "encoding-mojibake-guard.test.ts")),
]);

function walk(dir: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(path.extname(ent.name))) files.push(full);
  }
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  return files;
}

describe("encoding mojibake guard", () => {
  it("has no forbidden mojibake tokens in scoped source trees", () => {
    const violations: string[] = [];

    for (const file of collectFiles()) {
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (EXCLUDED_RELATIVE.has(rel)) continue;

      const text = fs.readFileSync(file, "utf8");
      for (const { label, value } of FORBIDDEN_TOKENS) {
        if (text.includes(value)) {
          violations.push(`${rel} (${label})`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
