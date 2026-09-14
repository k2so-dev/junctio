import { eq } from "drizzle-orm";
import { loadConfig } from "./config.ts";
import { createCore, databaseFile } from "./core.ts";
import { createApp } from "./server/app.ts";
import { servers } from "./db/schema.ts";
import { pruneRequestLog } from "./server/requestlog.ts";

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

const app = createApp({ core });

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  idleTimeout: 0,
  fetch: app.fetch
});

core.logger.info("listening", { url: `http://${config.host}:${config.port}` });

for (const row of core.db.select().from(servers).where(eq(servers.warm, true)).all()) {
  if (!row.enabled || row.transport !== "stdio") continue;
  core.supervisor.acquire(row.id).catch((error: unknown) => {
    core.logger.warn("warm start failed", { server: row.id, error: String(error) });
  });
}

const pruneTimer = setInterval(() => pruneRequestLog(core), 3_600_000);
pruneTimer.unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  core.logger.info("shutting down", { signal });
  clearInterval(pruneTimer);
  await server.stop(true);
  await core.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
