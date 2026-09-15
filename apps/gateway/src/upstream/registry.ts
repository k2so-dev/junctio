import { eq } from "drizzle-orm";
import { parseDockerRun } from "@junctio/schema";
import type { Db } from "../db/index.ts";
import { servers } from "../db/schema.ts";
import type { ServerRow } from "../db/schema.ts";
import type { Cipher } from "../crypto.ts";
import type { ResolvedServer } from "./types.ts";
import { buildArgv, buildChildEnv, previewCommand } from "./command.ts";
import type { SpawnSpec } from "./supervisor.ts";
import { gatewayId, getSetting } from "../db/settings.ts";

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
    const env = row.envEnc ? (JSON.parse(await this.cipher.decrypt(row.envEnc)) as Record<string, string>) : row.env;
    const resolved: ResolvedServer = { row, headers, env };
    this.cache.set(serverId, resolved);
    return resolved;
  }

  async spawnSpec(serverId: string): Promise<SpawnSpec | null> {
    const resolved = await this.resolve(serverId);
    if (!resolved || resolved.row.transport !== "stdio") return null;
    const { row } = resolved;
    const idleTimeoutSec = row.idleTimeoutSec;
    const warm = row.warm;

    if (row.runtime === "docker") {
      const env = Object.fromEntries(Object.entries(resolved.env).filter(([key]) => !key.startsWith("JUNCTIO_")));
      const parsed = parseDockerRun(row.args, env);
      if (!parsed.spec) throw new Error(parsed.errors.join("; "));
      const container = { ...parsed.spec, workdir: parsed.spec.workdir ?? row.cwd };
      return {
        launch: {
          kind: "container",
          gatewayId: gatewayId(this.db),
          serverId: row.id,
          name: row.name,
          container
        },
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
          env: resolved.env,
          path: getSetting(this.db, "runtime_path"),
          home: Bun.env.HOME ?? "/tmp",
          runtime: row.runtime
        })
      },
      idleTimeoutSec,
      warm
    };
  }

  preview(row: ServerRow): string {
    if (row.transport !== "stdio") return row.url ?? "";
    return previewCommand({ runtime: row.runtime, args: row.args });
  }
}
