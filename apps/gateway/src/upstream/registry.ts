import { eq } from "drizzle-orm";
import { parseDockerRun } from "@junctio/schema";
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
    const idleTimeoutSec = row.idleTimeoutSec;
    const warm = row.warm;

    if (row.runtime === "docker") {
      const env = Object.fromEntries(Object.entries(row.env).filter(([key]) => !key.startsWith("JUNCTIO_")));
      const parsed = parseDockerRun(row.args, env);
      if (!parsed.spec) throw new Error(parsed.errors.join("; "));
      const container = { ...parsed.spec, workdir: parsed.spec.workdir ?? row.cwd };
      return {
        launch: { kind: "container", serverId: row.id, name: row.name, container },
        idleTimeoutSec,
        warm
      };
    }

    return {
      launch: {
        kind: "process",
        argv: buildArgv({ runtime: row.runtime, args: row.args }),
        cwd: row.cwd,
        env: buildChildEnv({
          env: row.env,
          path: getSetting(this.db, "runtime_path"),
          home: Bun.env.HOME ?? "/tmp"
        })
      },
      idleTimeoutSec,
      warm
    };
  }

  preview(row: ServerRow): string {
    if (row.transport === "http") return row.url ?? "";
    return previewCommand({ runtime: row.runtime, args: row.args });
  }
}
