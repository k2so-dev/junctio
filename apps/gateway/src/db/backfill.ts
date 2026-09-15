import type { Database } from "bun:sqlite";
import { eq, isNull } from "drizzle-orm";
import type { Db } from "./index.ts";
import { servers } from "./schema.ts";
import type { Cipher } from "../crypto.ts";
import type { Logger } from "../log.ts";

export async function backfillServerEnv(db: Db, sqlite: Database, cipher: Cipher, logger: Logger): Promise<void> {
  const pending = db
    .select()
    .from(servers)
    .where(isNull(servers.envEnc))
    .all()
    .filter((row) => Object.keys(row.env).length > 0);
  if (pending.length === 0) return;

  for (const row of pending) {
    const envEnc = await cipher.encrypt(JSON.stringify(row.env));
    db.update(servers).set({ envEnc, env: {} }).where(eq(servers.id, row.id)).run();
  }
  sqlite.exec("VACUUM");
  logger.info("encrypted server env at rest", { servers: pending.length });
}
