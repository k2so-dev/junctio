import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig, type Config } from "../src/config.ts";
import { createCore, type Core } from "../src/core.ts";
import { createApp } from "../src/server/app.ts";
import { setLogLevel } from "../src/log.ts";
import { apiKeys, endpoints, namespaceServers, namespaces, servers } from "../src/db/schema.ts";
import { createApiKey } from "../src/auth/downstream/apikey.ts";
import { randomId } from "../src/crypto.ts";
import type { RemoteJwtVerifier } from "../src/auth/downstream/jwt.ts";

setLogLevel("error");

export const MOCK_STDIO = new URL("./fixtures/mock-stdio-server.ts", import.meta.url).pathname;

export type Harness = {
  core: Core;
  config: Config;
  url: string;
  stop(): Promise<void>;
};

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    JUNCTIO_SECRET: "test-secret-value-0123456789abcdef",
    JUNCTIO_DATA_DIR: "/tmp/junctio-test",
    LOG_LEVEL: "error",
    ...overrides
  });
}

export async function startHarness(options: { verifier?: RemoteJwtVerifier | null; env?: Record<string, string> } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "junctio-test-"));
  const config = testConfig({ JUNCTIO_DATA_DIR: dir, ...(options.env ?? {}) });
  const core = createCore({ config, dbFile: join(dir, "junctio.db") });
  const app = createApp({ core, verifier: options.verifier ?? null, publicDir: null });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: app.fetch });
  return {
    core,
    config,
    url: `http://127.0.0.1:${server.port}`,
    async stop() {
      await server.stop(true);
      await core.shutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

export function seedStdioServer(
  core: Core,
  options: { name?: string; env?: Record<string, string>; idleTimeoutSec?: number } = {}
): string {
  const id = randomId();
  core.db
    .insert(servers)
    .values({
      id,
      name: options.name ?? "mock",
      transport: "stdio",
      runtime: "custom",
      command: "bun",
      args: [MOCK_STDIO],
      env: {
        PATH: Bun.env.PATH ?? "/usr/bin",
        HOME: Bun.env.HOME ?? "/tmp",
        MOCK_NAME: options.name ?? "mock",
        ...(options.env ?? {})
      },
      cwd: null,
      url: null,
      headersEnc: null,
      authMode: "none",
      oauthScope: null,
      enabled: true,
      warm: false,
      idleTimeoutSec: options.idleTimeoutSec ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    .run();
  return id;
}

export function seedHttpServer(core: Core, options: { name: string; url: string; authMode?: "none" | "header" | "oauth" }): string {
  const id = randomId();
  core.db
    .insert(servers)
    .values({
      id,
      name: options.name,
      transport: "http",
      runtime: "custom",
      command: "",
      args: [],
      env: {},
      cwd: null,
      url: options.url,
      headersEnc: null,
      authMode: options.authMode ?? "none",
      oauthScope: null,
      enabled: true,
      warm: false,
      idleTimeoutSec: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    .run();
  return id;
}

export function seedNamespace(core: Core, name: string, members: { serverId: string; prefix?: string }[]): string {
  const id = randomId();
  core.db.insert(namespaces).values({ id, name, description: null, createdAt: Date.now() }).run();
  for (const member of members) {
    core.db
      .insert(namespaceServers)
      .values({ namespaceId: id, serverId: member.serverId, prefix: member.prefix ?? null, enabled: true })
      .run();
  }
  return id;
}

export function seedEndpoint(
  core: Core,
  options: { slug: string; namespaceId: string; authMode?: "none" | "api_key" | "oauth" | "any" }
): string {
  const id = randomId();
  core.db
    .insert(endpoints)
    .values({
      id,
      slug: options.slug,
      namespaceId: options.namespaceId,
      authMode: options.authMode ?? "api_key",
      protocolMin: "2025-06-18",
      rateLimit: { perMinute: 0 },
      enabled: true,
      createdAt: Date.now()
    })
    .run();
  return id;
}

export async function seedApiKey(core: Core, endpointId: string | null): Promise<string> {
  const { token } = await createApiKey(core.db, { name: "test", endpointId, expiresAt: null });
  return token;
}

export function keyCount(core: Core): number {
  return core.db.select().from(apiKeys).all().length;
}

export async function connectClient(url: string, token: string | null): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined
  });
  await client.connect(transport);
  return client;
}
