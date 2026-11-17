import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/** Apply any migration in db/migrations that hasn't run yet, in file-name order. */
export function migrate(db: DB, dir = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const done = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name),
  );
  const applied: string[] = [];
  for (const file of fs.readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
    })();
    applied.push(file);
  }
  return applied;
}

/** Open a database file (or ":memory:") with Pinch's settings and run migrations. */
export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

let shared: DB | undefined;

/** The app's database, opened once per server process. */
export function getDb(): DB {
  if (!shared) shared = openDb(process.env.PINCH_DB_PATH || "./data/pinch.db");
  return shared;
}
