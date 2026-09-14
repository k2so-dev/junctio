import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema.ts";
import { log } from "../log.ts";

export type Db = BunSQLiteDatabase<typeof schema>;

export const MIGRATIONS_FOLDER = join(import.meta.dir, "migrations");

export function openDatabase(file: string): { db: Db; sqlite: Database } {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function backupDatabase(file: string): void {
  if (file === ":memory:" || !existsSync(file)) return;
  const target = `${file}.bak`;
  try {
    copyFileSync(file, target);
    log.info("database backup created", { target });
  } catch (error) {
    log.warn("database backup failed", { error: String(error) });
  }
}

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export function initDatabase(file: string): { db: Db; sqlite: Database } {
  backupDatabase(file);
  const { db, sqlite } = openDatabase(file);
  runMigrations(db);
  return { db, sqlite };
}

export { schema };
