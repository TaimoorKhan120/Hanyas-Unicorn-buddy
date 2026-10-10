// Apply pending SQL migrations to DATABASE_URL (or the local dev PGlite store). Run: npm run migrate
import { getDb } from "../src/lib/db.ts";

await getDb();
console.log("migrations up to date");
process.exit(0);
