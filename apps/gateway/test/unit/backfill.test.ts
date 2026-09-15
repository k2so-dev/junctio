import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { openDatabase, runMigrations } from "../../src/db/index.ts";
import { servers } from "../../src/db/schema.ts";
import { backfillServerEnv } from "../../src/db/backfill.ts";
import { createCipher } from "../../src/crypto.ts";
import { createLogger } from "../../src/log.ts";

function seed() {
  const { db, sqlite } = openDatabase(":memory:");
  runMigrations(db);
  return { db, sqlite };
}

describe("server env backfill", () => {
  test("encrypts plaintext env and clears the legacy column", async () => {
    const { db, sqlite } = seed();
    const cipher = createCipher("a-secret-long-enough");
    db.insert(servers)
      .values({ id: "one", name: "one", transport: "stdio", env: { TOKEN: "plaintext" } })
      .run();

    await backfillServerEnv(db, sqlite, cipher, createLogger());

    const row = db.select().from(servers).where(eq(servers.id, "one")).get();
    expect(row?.env).toEqual({});
    expect(row?.envEnc).toBeTruthy();
    expect(JSON.parse(await cipher.decrypt(row?.envEnc ?? ""))).toEqual({ TOKEN: "plaintext" });
    sqlite.close(false);
  });

  test("leaves already encrypted rows alone", async () => {
    const { db, sqlite } = seed();
    const cipher = createCipher("a-secret-long-enough");
    const envEnc = await cipher.encrypt(JSON.stringify({ TOKEN: "kept" }));
    db.insert(servers).values({ id: "one", name: "one", transport: "stdio", envEnc }).run();

    await backfillServerEnv(db, sqlite, cipher, createLogger());

    const row = db.select().from(servers).where(eq(servers.id, "one")).get();
    expect(row?.envEnc).toBe(envEnc);
    sqlite.close(false);
  });
});
