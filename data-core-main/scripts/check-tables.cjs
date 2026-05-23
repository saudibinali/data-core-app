const pg = require("pg");
const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

const p = new pg.Pool({
  connectionString: resolveDatabaseUrl(),
});
p.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'workspace_%'
   ORDER BY 1`,
)
  .then((r) => {
    console.log(r.rows);
    return p.end();
  })
  .catch((e) => {
    console.error(e.message);
    p.end();
    process.exit(1);
  });
