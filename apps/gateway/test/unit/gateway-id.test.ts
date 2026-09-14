import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, runMigrations } from "../../src/db/index.ts";
import { reconcileGatewayId } from "../../src/db/settings.ts";

let dir = "";

function freshDb() {
  const { db, sqlite } = openDatabase(":memory:");
  runMigrations(db);
  return { db, sqlite };
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("gateway id", () => {
  test("persists a new id next to the database", () => {
    dir = mkdtempSync(join(tmpdir(), "junctio-gw-"));
    const { db, sqlite } = freshDb();

    const id = reconcileGatewayId(db, dir);

    expect(id).toBeTruthy();
    expect(readFileSync(join(dir, "gateway-id"), "utf8").trim()).toBe(id);
    sqlite.close(false);
  });

  test("recovers the id from disk when the database is recreated", () => {
    dir = mkdtempSync(join(tmpdir(), "junctio-gw-"));
    const first = freshDb();
    const original = reconcileGatewayId(first.db, dir);
    first.sqlite.close(false);

    const second = freshDb();
    expect(reconcileGatewayId(second.db, dir)).toBe(original);
    second.sqlite.close(false);
  });
});
