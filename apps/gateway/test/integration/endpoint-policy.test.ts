import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { endpoints, requestLog } from "../../src/db/schema.ts";
import { seedEndpoint, seedHttpServer, seedNamespace, seedStdioServer, startHarness, type Harness } from "../helpers.ts";

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.stop();
});

function initialize(protocolVersion: string): BodyInit {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });
}

async function post(slug: string, body: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${harness.url}/mcp/${slug}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers
    },
    body
  });
}

function prepare(slug: string, patch: Partial<{ protocolMin: string; rateLimit: { perMinute: number } }> = {}): void {
  const serverId = seedStdioServer(harness.core, { name: "alpha" });
  const namespaceId = seedNamespace(harness.core, "team", [{ serverId }]);
  const endpointId = seedEndpoint(harness.core, { slug, namespaceId, authMode: "none" });
  if (Object.keys(patch).length > 0) {
    harness.core.db.update(endpoints).set(patch).where(eq(endpoints.id, endpointId)).run();
  }
}

describe("endpoint protocol floor", () => {
  test("rejects an initialize below the endpoint minimum", async () => {
    prepare("team", { protocolMin: "2025-11-25" });
    const response = await post("team", initialize("2025-06-18"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: number; message: string; data: { supported: string[]; requested: string } };
    };
    expect(body.error.message).toContain("2025-11-25");
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toEqual(["2025-11-25", "2026-07-28"]);
    expect(body.error.data.requested).toBe("2025-06-18");
  });

  test("rejects a follow-up request carrying an older protocol header", async () => {
    prepare("team", { protocolMin: "2025-11-25" });
    const response = await post("team", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), {
      "mcp-protocol-version": "2025-06-18"
    });
    expect(response.status).toBe(400);
  });

  test("logs the refusal so the endpoint page can explain it", async () => {
    prepare("team", { protocolMin: "2026-07-28" });
    await post("team", initialize("2025-11-25"));
    const logged = harness.core.db.select().from(requestLog).all();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.protocol).toBe("2025-11-25");
    expect(logged[0]?.errorCode).toBe("unsupported_protocol");
    expect(logged[0]?.method).toBe("initialize");
  });

  test("authenticates before looking at the protocol", async () => {
    const serverId = seedStdioServer(harness.core, { name: "alpha" });
    const namespaceId = seedNamespace(harness.core, "team", [{ serverId }]);
    const endpointId = seedEndpoint(harness.core, { slug: "team", namespaceId, authMode: "api_key" });
    harness.core.db.update(endpoints).set({ protocolMin: "2025-11-25" }).where(eq(endpoints.id, endpointId)).run();
    const response = await post("team", initialize("2025-06-18"));
    expect(response.status).toBe(401);
  });

  test("accepts a client at or above the minimum", async () => {
    prepare("team", { protocolMin: "2025-06-18" });
    const response = await post("team", initialize("2025-11-25"));
    expect(response.status).toBe(200);
  });
});

describe("endpoint rate limit", () => {
  test("allows every request when the limit is zero", async () => {
    prepare("team");
    for (let i = 0; i < 5; i += 1) {
      const response = await post("team", initialize("2025-06-18"));
      expect(response.status).toBe(200);
    }
  });

  test("returns 429 with retry-after once the budget is spent", async () => {
    prepare("team", { rateLimit: { perMinute: 2 } });
    expect((await post("team", initialize("2025-06-18"))).status).toBe(200);
    expect((await post("team", initialize("2025-06-18"))).status).toBe(200);

    const limited = await post("team", initialize("2025-06-18"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await limited.json()) as { error: { message: string } };
    expect(body.error.message).toContain("rate limit");
  });
});

describe("health", () => {
  test("counts upstreams that need a fresh login", async () => {
    const before = (await (await fetch(`${harness.url}/health`)).json()) as {
      status: string;
      servers: { needsReauth: number };
    };
    expect(before.servers.needsReauth).toBe(0);
    expect(before.status).toBe("ok");

    await seedHttpServer(harness.core, { name: "remote", url: "https://example.com/mcp", authMode: "oauth" });

    const after = (await (await fetch(`${harness.url}/health`)).json()) as {
      status: string;
      servers: { needsReauth: number };
    };
    expect(after.servers.needsReauth).toBe(1);
    expect(after.status).toBe("degraded");
  });
});
