import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { createLogger, setLogLevel, type Logger } from "./log.ts";
import { createCipher, type Cipher } from "./crypto.ts";
import { initDatabase, type Db } from "./db/index.ts";
import { LogRegistry } from "./upstream/logbuffer.ts";
import { ProcessSupervisor } from "./upstream/supervisor.ts";
import { ServerRegistry } from "./upstream/registry.ts";
import { UpstreamPool } from "./upstream/pool.ts";
import { Aggregator } from "./aggregate/aggregator.ts";
import { noopUpstreamAuth, type UpstreamAuth } from "./upstream/types.ts";

export type Core = {
  config: Config;
  logger: Logger;
  db: Db;
  sqlite: Database;
  cipher: Cipher;
  logs: LogRegistry;
  registry: ServerRegistry;
  supervisor: ProcessSupervisor;
  pool: UpstreamPool;
  aggregator: Aggregator;
  startedAt: number;
  setUpstreamAuth(auth: UpstreamAuth): void;
  shutdown(): Promise<void>;
};

export type CoreOptions = {
  config: Config;
  dbFile?: string;
};

export function databaseFile(config: Config): string {
  return join(config.dataDir, "junctio.db");
}

export function createCore(options: CoreOptions): Core {
  const { config } = options;
  setLogLevel(config.logLevel);
  const logger = createLogger();
  const { db, sqlite } = initDatabase(options.dbFile ?? databaseFile(config));
  const cipher = createCipher(config.secret);
  const logs = new LogRegistry();
  const registry = new ServerRegistry(db, cipher);

  let auth: UpstreamAuth = noopUpstreamAuth;
  const authProxy: UpstreamAuth = {
    authHeaders: (server) => auth.authHeaders(server),
    handleUnauthorized: (serverId) => auth.handleUnauthorized(serverId)
  };

  let pool: UpstreamPool;
  const supervisor = new ProcessSupervisor({
    getSpec: (serverId) => registry.spawnSpec(serverId),
    logs,
    logger,
    onExit: (serverId, generation) => pool.onProcessExit(serverId, generation)
  });
  pool = new UpstreamPool({ registry, supervisor, auth: authProxy, logger, logs });
  const aggregator = new Aggregator(db, pool, logger);

  return {
    config,
    logger,
    db,
    sqlite,
    cipher,
    logs,
    registry,
    supervisor,
    pool,
    aggregator,
    startedAt: Date.now(),
    setUpstreamAuth(next) {
      auth = next;
    },
    async shutdown() {
      await pool.shutdown();
      await supervisor.shutdown();
      sqlite.close(false);
    }
  };
}
