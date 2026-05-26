const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const files = [
  "src/routes/__tests__/leave-canonical.smoke.test.ts",
  "src/routes/__tests__/workforce-attendance-import.smoke.test.ts",
  "src/routes/__tests__/notification-infrastructure.smoke.test.ts",
  "src/routes/__tests__/leave-bridge.smoke.test.ts",
  "src/routes/__tests__/workforce-attendance.smoke.test.ts",
  "src/routes/__tests__/document-registry.smoke.test.ts",
  "src/routes/__tests__/workforce-self-service.smoke.test.ts",
  "src/lib/payroll/__tests__/payroll-foundation.smoke.test.ts",
  "src/routes/__tests__/leave-pilot-production.test.ts",
  "src/lib/workforce-ops/__tests__/workforce-operations.smoke.test.ts",
  "src/routes/__tests__/pdf-scheduled-reports.smoke.test.ts",
  "src/routes/__tests__/reporting-engine.smoke.test.ts",
  "src/routes/__tests__/leave-cutover.safety.test.ts",
  "src/lib/workforce-integration/__tests__/workforce-integration.smoke.test.ts",
];

function relImport(file) {
  const dir = path.dirname(file);
  const rel = path.relative(dir, "src/test-utils/smoke-db").replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

for (const f of files) {
  const full = path.join(root, f);
  let t = fs.readFileSync(full, "utf8");
  if (t.includes("isSmokeDatabaseAvailable")) continue;

  const importPath = relImport(f);
  const importLine = `import { isSmokeDatabaseAvailable } from "${importPath}";\n`;

  t = t.replace(
    /const HAS_DB = Boolean\(process\.env\.DATABASE_URL\);\nconst RUN = HAS_DB && process\.env\.(\w+) !== "0";/,
    `${importLine}\nconst RUN = isSmokeDatabaseAvailable() && process.env.$1 !== "0";`,
  );

  if (!t.includes("isSmokeDatabaseAvailable")) {
    t = t.replace(
      /const HAS_DB = Boolean\(process\.env\.DATABASE_URL\);\nconst RUN = HAS_DB;/,
      `${importLine}\nconst RUN = isSmokeDatabaseAvailable();`,
    );
  }

  fs.writeFileSync(full, t);
  console.log("updated", f);
}
