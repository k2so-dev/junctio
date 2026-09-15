import { eq } from "drizzle-orm";
import { loadConfig } from "./config.ts";
import { createCore, databaseFile } from "./core.ts";
import { createApp } from "./server/app.ts";
import { servers } from "./db/schema.ts";
import { pruneRequestLog } from "./server/requestlog.ts";
import { checkTmpdir } from "./upstream/tmpdir.ts";
import { reapContainers } from "./upstream/docker/launcher.ts";
import { reconcileGatewayId } from "./db/settings.ts";

export async function serve(): Promise<void> {
  const config = (() => {
    try {
      return loadConfig();
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  })();

  const core = createCore({ config });
  core.logger.info("starting junctio", {
    version: config.version,
    database: databaseFile(config),
    baseUrl: config.baseUrl
  });

  const tmpdir = checkTmpdir();
  if (!tmpdir.writable) {
    core.logger.error("temporary directory is not writable", {
      tmpdir: tmpdir.path,
      hint: "stdio servers and the audit cannot run; point TMPDIR at a writable path"
    });
  }
  if (tmpdir.noexec) {
    core.logger.warn("temporary directory is mounted noexec", {
      tmpdir: tmpdir.path,
      hint: "bunx and uvx cannot launch packages from it; point TMPDIR at a writable, exec-capable path"
    });
  }

  await reapContainers(core.docker, core.logger, reconcileGatewayId(core.db, config.dataDir));

  const app = createApp({ core });

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    idleTimeout: 0,
    fetch: (request, bunServer) => app.fetch(request, { ip: bunServer.requestIP(request)?.address ?? null })
  });

  core.logger.info("listening", { url: `http://${config.host}:${config.port}` });

  core.upstreamAuth.start();
  core.audit.store.pruneOrphans();
  core.audit.sweepTemp();
  core.audit.start();

  for (const row of core.db.select().from(servers).where(eq(servers.warm, true)).all()) {
    if (row.transport !== "stdio") continue;
    core.supervisor.acquire(row.id).catch((error: unknown) => {
      core.logger.warn("warm start failed", { server: row.id, error: String(error) });
    });
  }

  const pruneTimer = setInterval(() => {
    pruneRequestLog(core);
    core.oauthProvider.prune();
  }, 3_600_000);
  pruneTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string, code = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    core.logger.info("shutting down", { signal });
    clearInterval(pruneTimer);
    await server.stop(true);
    await core.shutdown();
    process.exit(code);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    core.logger.error("unhandled rejection", { error: reason instanceof Error ? reason.message : String(reason) });
  });
  process.on("uncaughtException", (error) => {
    core.logger.error("uncaught exception", { error: error.stack ?? error.message });
    void shutdown("uncaughtException", 1);
  });
}
