import fs from "fs";
import path from "path";

function checkFile(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const re = /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/gs;
  let m;
  while ((m = re.exec(src))) {
    const names = m[1]
      .split(",")
      .map((p) => p.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    const seen = new Set();
    const dups = [];
    for (const n of names) {
      if (seen.has(n)) dups.push(n);
      seen.add(n);
    }
    if (dups.length) {
      console.log(`${filePath}: duplicate ${[...new Set(dups)].join(", ")}`);
    }
  }
}

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith(".tsx") || ent.name.endsWith(".ts")) checkFile(p);
  }
}

walk(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
