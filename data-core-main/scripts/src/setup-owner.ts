/**
 * Bootstrap script: creates the platform super_admin owner account.
 * Run once: pnpm --filter @workspace/scripts run setup-owner
 *
 * Reads OWNER_EMPLOYEE_NUMBER, OWNER_NAME, OWNER_PASSWORD from env (or prompts).
 * Creates the super_admin user directly in the database with a hashed password.
 */
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function ask(rl: readline.Interface, question: string, hidden = false): Promise<string> {
  if (hidden) {
    return new Promise((resolve) => {
      process.stdout.write(question);
      process.stdin.setRawMode?.(true);
      let pw = "";
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      const onData = (ch: string) => {
        if (ch === "\n" || ch === "\r" || ch === "\u0003") {
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(pw);
        } else if (ch === "\u007f") {
          pw = pw.slice(0, -1);
        } else {
          pw += ch;
        }
      };
      process.stdin.on("data", onData);
    });
  }
  return rl.question(question);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌  DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });

  console.log("\n🚀  Platform Owner Setup\n");
  console.log("This creates the first super_admin account for the platform owner.");
  console.log("Run this once — repeat runs will update the existing account.\n");

  const employeeNumber = process.env.OWNER_EMPLOYEE_NUMBER ?? await ask(rl, "Employee Number (e.g. ADMIN001): ");
  const fullName = process.env.OWNER_NAME ?? await ask(rl, "Full name: ");
  const email = process.env.OWNER_EMAIL ?? await ask(rl, "Email (optional, press Enter to skip): ");
  const password = process.env.OWNER_PASSWORD ?? await ask(rl, "Password (min 8 chars): ", true);

  rl.close();

  if (!employeeNumber || !fullName || !password) {
    console.error("❌  Employee number, full name, and password are required.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌  Password must be at least 8 characters.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  console.log("\n⏳  Hashing password...");
  const passwordHash = await bcrypt.hash(password, 12);

  console.log("⏳  Creating super_admin in database...");

  const existing = await db.select().from(usersTable).where(eq(usersTable.employeeNumber, employeeNumber));

  if (existing.length > 0) {
    console.log("⚠️  User with this employee number already exists — updating to super_admin.");
    await db.update(usersTable)
      .set({ role: "super_admin", passwordHash, fullName, email: email || null })
      .where(eq(usersTable.employeeNumber, employeeNumber));
  } else {
    const firstName = fullName.split(" ")[0] ?? fullName;
    const lastName = fullName.split(" ").slice(1).join(" ") || null;
    await db.insert(usersTable).values({
      workspaceId: null,
      email: email || null,
      firstName,
      lastName,
      fullName,
      employeeNumber,
      passwordHash,
      role: "super_admin",
      status: "active",
    });
  }

  await pool.end();

  console.log("\n✅  Platform owner account ready!\n");
  console.log(`   Employee Number: ${employeeNumber}`);
  console.log(`   Full Name:       ${fullName}`);
  console.log(`   Role:            super_admin`);
  console.log("\nNext steps:");
  console.log("  1. Sign in at /sign-in with your employee number and password");
  console.log("  2. Use the Super Admin panel to create company workspaces");
  console.log("  3. Workspace admins can then create users from the Users page\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
