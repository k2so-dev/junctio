import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from "@modelcontextprotocol/client";
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

export async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

export type HarnessOptions = {
  verifier?: RemoteJwtVerifier | null;
  env?: Record<string, string>;
  withBaseUrl?: boolean;
  refreshIntervalMs?: number;
  fetchImpl?: typeof fetch;
  registryTimeoutMs?: number;
};

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "junctio-test-"));
  const port = options.withBaseUrl ? await freePort() : 0;
  const config = testConfig({
    JUNCTIO_DATA_DIR: dir,
    ...(options.withBaseUrl ? { JUNCTIO_BASE_URL: `http://127.0.0.1:${port}` } : {}),
    ...(options.env ?? {})
  });
  const core = createCore({
    config,
    dbFile: join(dir, "junctio.db"),
    ...(options.refreshIntervalMs ? { refreshIntervalMs: options.refreshIntervalMs } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.registryTimeoutMs ? { registryTimeoutMs: options.registryTimeoutMs } : {})
  });
  const app = createApp({ core, verifier: options.verifier ?? null, publicDir: null });
  const server = Bun.serve({ port, hostname: "127.0.0.1", idleTimeout: 0, fetch: app.fetch });
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
  options: { name?: string; env?: Record<string, string>; idleTimeoutSec?: number; fixture?: string } = {}
): string {
  const id = randomId();
  core.db
    .insert(servers)
    .values({
      id,
      name: options.name ?? "mock",
      transport: "stdio",
      runtime: "custom",
      args: ["bun", options.fixture ?? MOCK_STDIO],
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

export async function seedHttpServer(
  core: Core,
  options: {
    name: string;
    url: string;
    authMode?: "none" | "header" | "oauth";
    transport?: "http" | "sse";
    headers?: Record<string, string>;
  }
): Promise<string> {
  const id = randomId();
  core.db
    .insert(servers)
    .values({
      id,
      name: options.name,
      transport: options.transport ?? "http",
      runtime: "custom",
      args: [],
      env: {},
      cwd: null,
      url: options.url,
      headersEnc: options.headers ? await core.cipher.encrypt(JSON.stringify(options.headers)) : null,
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
  options: { slug: string; namespaceId: string; authMode?: "none" | "api_key" | "oauth" | "any"; protocolMin?: string }
): string {
  const id = randomId();
  core.db
    .insert(endpoints)
    .values({
      id,
      slug: options.slug,
      namespaceId: options.namespaceId,
      authMode: options.authMode ?? "api_key",
      protocolMin: options.protocolMin ?? "2025-06-18",
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

export async function connectClient(
  url: string,
  token: string | null,
  mode: VersionNegotiationMode = "legacy"
): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {}, versionNegotiation: { mode } });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined
  });
  await client.connect(transport);
  return client;
}

export const MOCK_STDIO_MODERN = new URL("./fixtures/mock-stdio-modern.ts", import.meta.url).pathname;
