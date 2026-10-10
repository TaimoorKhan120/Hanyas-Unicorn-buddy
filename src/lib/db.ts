// Database access: one tiny interface over node-postgres (production) and PGlite (tests, zero-setup dev).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type Row = Record<string, unknown>;
export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run a multi-statement script without parameters (migrations). */
  exec(sql: string): Promise<unknown>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  dbPromise ??= open().then(async (db) => {
    await migrate(db);
    return db;
  });
  // Don't cache a failed open forever.
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

/** Tests inject their own in-memory database. */
export function setDb(db: Db) {
  dbPromise = Promise.resolve(db);
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return openPg(url);
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
  return openPglite(path.join(process.cwd(), ".data", "pglite"));
}

async function openPg(url: string): Promise<Db> {
  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: url, max: 5 });
  return {
    query: (sql, params) => pool.query(sql, params) as never,
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: (sql, params) => client.query(sql, params) as never,
          exec: (sql) => client.query(sql),
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dataDir);
  return {
    query: (sql, params) => pg.query(sql, params) as never,
    exec: (sql) => pg.exec(sql),
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never, exec: (sql) => t.exec(sql) })),
  };
}

export async function migrate(db: Db) {
  const dir = path.join(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await db.tx(async (q) => {
    // Serialise concurrent cold starts.
    await q.query("SELECT pg_advisory_xact_lock(4242)");
    await q.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await q.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      await q.exec(readFileSync(path.join(dir, f), "utf8"));
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    }
  });
}
