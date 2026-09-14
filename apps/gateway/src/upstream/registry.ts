import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { servers } from "../db/schema.ts";
import type { ServerRow } from "../db/schema.ts";
import type { Cipher } from "../crypto.ts";
import type { ResolvedServer } from "./types.ts";
import { buildArgv, buildChildEnv, previewCommand } from "./command.ts";
import type { SpawnSpec } from "./supervisor.ts";
import { getSetting } from "../db/settings.ts";

export class ServerRegistry {
  private readonly cache = new Map<string, ResolvedServer>();

  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher
  ) {}

  invalidate(serverId?: string): void {
    if (serverId) this.cache.delete(serverId);
    else this.cache.clear();
  }

  row(serverId: string): ServerRow | null {
    return this.db.select().from(servers).where(eq(servers.id, serverId)).get() ?? null;
  }

  async resolve(serverId: string): Promise<ResolvedServer | null> {
    const cached = this.cache.get(serverId);
    if (cached) return cached;
    const row = this.row(serverId);
    if (!row) return null;
    const headers = row.headersEnc ? (JSON.parse(await this.cipher.decrypt(row.headersEnc)) as Record<string, string>) : {};
    const resolved: ResolvedServer = { row, headers };
    this.cache.set(serverId, resolved);
    return resolved;
  }

  spawnSpec(serverId: string): SpawnSpec | null {
    const row = this.row(serverId);
    if (!row || row.transport !== "stdio") return null;
    return {
      argv: buildArgv({ runtime: row.runtime, command: row.command, args: row.args }),
      cwd: row.cwd,
      env: buildChildEnv({
        env: row.env,
        path: getSetting(this.db, "runtime_path"),
        home: Bun.env.HOME ?? "/tmp"
      }),
      idleTimeoutSec: row.idleTimeoutSec,
      warm: row.warm
    };
  }

  preview(row: ServerRow): string {
    if (row.transport === "http") return row.url ?? "";
    return previewCommand({ runtime: row.runtime, command: row.command, args: row.args });
  }
}
