#!/usr/bin/env node
/**
 * Ensures lib/db/drizzle/*.sql matches meta/_journal.json (F0.2 gate).
 * Exit 0 = aligned, 1 = drift detected.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "lib/db/drizzle");
const journalPath = path.join(migrationsDir, "meta/_journal.json");

function listSqlTags() {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
}

function main() {
  const issues = [];

  if (!fs.existsSync(journalPath)) {
    console.error(JSON.stringify({ ok: false, error: "JOURNAL_MISSING", journalPath }, null, 2));
    process.exit(1);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const entries = journal.entries ?? [];
  const journalTags = entries.map((e) => e.tag).sort();
  const sqlTags = listSqlTags();

  for (const tag of sqlTags) {
    if (!journalTags.includes(tag)) {
      issues.push({ code: "SQL_NOT_IN_JOURNAL", tag });
    }
  }

  for (const tag of journalTags) {
    if (!sqlTags.includes(tag)) {
      issues.push({ code: "JOURNAL_MISSING_SQL", tag });
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const expectedIdx = i;
    if (entries[i].idx !== expectedIdx) {
      issues.push({
        code: "JOURNAL_IDX_GAP",
        message: `entry ${entries[i].tag} has idx ${entries[i].idx}, expected ${expectedIdx}`,
      });
    }
  }

  const sortedByTag = [...entries].sort((a, b) => a.tag.localeCompare(b.tag));
  const sortedByIdx = [...entries].sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < entries.length; i++) {
    if (sortedByTag[i].tag !== sortedByIdx[i].tag) {
      issues.push({
        code: "JOURNAL_ORDER_MISMATCH",
        message: "idx order does not match lexical migration tag order",
      });
      break;
    }
  }

  const report = {
    ok: issues.length === 0,
    sqlFileCount: sqlTags.length,
    journalEntryCount: journalTags.length,
    issues,
    checkedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
