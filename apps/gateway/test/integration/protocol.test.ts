import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { endpoints, requestLog } from "../../src/db/schema.ts";
import { startMockHttpMcp, type MockHttpMcp } from "../fixtures/mock-http-mcp.ts";
import {
  connectClient,
  MOCK_STDIO_MODERN,
  seedApiKey,
  seedEndpoint,
  seedHttpServer,
  seedNamespace,
  seedStdioServer,
  startHarness,
  type Harness
} from "../helpers.ts";

const MODERN = "2026-07-28";
const ADMIN_TOKEN = "token-0123456789abcdef";

function text(result: { content: unknown }): string {
  const first = (result.content as { type: string; text?: string }[])[0];
  return first?.text ?? "";
}

describe("protocol eras", () => {
  let harness: Harness;
  let remote: MockHttpMcp;
  let token: string;
  let legacyUpstream: string;
  let modernUpstream: string;
  let httpUpstream: string;
  let fragileUpstream: string;

  beforeAll(async () => {
    harness = await startHarness({ env: { JUNCTIO_ADMIN_TOKEN: ADMIN_TOKEN } });
    remote = await startMockHttpMcp({ issuer: null, requireAuth: false, modern: true });
    legacyUpstream = await seedStdioServer(harness.core, { name: "legacy" });
    modernUpstream = await seedStdioServer(harness.core, { name: "modern", fixture: MOCK_STDIO_MODERN });
    httpUpstream = await seedHttpServer(harness.core, { name: "remote", url: remote.url });
    fragileUpstream = await seedStdioServer(harness.core, { name: "fragile", env: { MOCK_EXIT_ON_PROBE: "1" } });

    const mixed = seedNamespace(harness.core, "mixed", [
      { serverId: legacyUpstream },
      { serverId: modernUpstream },
      { serverId: httpUpstream }
    ]);
    const fragile = seedNamespace(harness.core, "fragile", [{ serverId: fragileUpstream }]);
    seedEndpoint(harness.core, { slug: "mixed", namespaceId: mixed });
    seedEndpoint(harness.core, { slug: "strict", namespaceId: mixed, protocolMin: MODERN });
    seedEndpoint(harness.core, { slug: "fragile", namespaceId: fragile });
    token = await seedApiKey(harness.core, null);
  });

  afterAll(async () => {
    await harness.stop();
    await remote.stop();
  });

  test("a 2026-07-28 client is served without an initialize handshake", async () => {
    const client = await connectClient(`${harness.url}/mcp/mixed`, token, { pin: MODERN });
    expect(client.getProtocolEra()).toBe("modern");
    expect(client.getNegotiatedProtocolVersion()).toBe(MODERN);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["legacy__echo", "modern__echo", "modern__era", "remote__ping"])
    );
    const echoed = await client.callTool({ name: "legacy__echo", arguments: { message: "hi" } });
    expect(text(echoed)).toBe("legacy: hi");
    await client.close();
  });

  test("a legacy client still gets the initialize handshake on the same endpoint", async () => {
    const client = await connectClient(`${harness.url}/mcp/mixed`, token);
    expect(client.getProtocolEra()).toBe("legacy");
    expect(client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
    const echoed = await client.callTool({ name: "legacy__echo", arguments: { message: "again" } });
    expect(text(echoed)).toBe("legacy: again");
    await client.close();
  });

  test("an auto-negotiating client lands on the modern era", async () => {
    const client = await connectClient(`${harness.url}/mcp/mixed`, token, "auto");
    expect(client.getProtocolEra()).toBe("modern");
    await client.close();
  });

  test("a modern stdio upstream is spoken to with the 2026-07-28 revision", async () => {
    const client = await connectClient(`${harness.url}/mcp/mixed`, token, { pin: MODERN });
    const era = await client.callTool({ name: "modern__era", arguments: {} });
    expect(text(era)).toBe("modern");
    expect(harness.core.pool.negotiated(modernUpstream)).toEqual({ era: "modern", protocolVersion: MODERN });
    expect(harness.core.pool.negotiated(legacyUpstream)).toEqual({ era: "legacy", protocolVersion: "2025-11-25" });
    await client.close();
  });

  test("a modern http upstream is probed once and reused", async () => {
    const client = await connectClient(`${harness.url}/mcp/mixed`, token);
    const first = await client.callTool({ name: "remote__ping", arguments: {} });
    expect(text(first)).toBe("pong (modern)");
    expect(harness.core.pool.negotiated(httpUpstream)?.era).toBe("modern");
    expect(remote.counts.eras.legacy).toBe(0);
    await client.close();
  });

  test("a strict endpoint refuses the legacy handshake and serves modern clients", async () => {
    await expect(connectClient(`${harness.url}/mcp/strict`, token)).rejects.toThrow(/2026-07-28|Unsupported protocol/);
    const client = await connectClient(`${harness.url}/mcp/strict`, token, { pin: MODERN });
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  });

  test("a hand-written modern request is served as the ui snippet spells it", async () => {
    const response = await fetch(`${harness.url}/mcp/mixed`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": "tools/list"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MODERN,
            "io.modelcontextprotocol/clientInfo": { name: "curl", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {}
          }
        }
      })
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result?: { tools?: unknown[] }; error?: unknown };
    expect(payload.error).toBeUndefined();
    expect(payload.result?.tools?.length).toBeGreaterThan(0);
  });

  test("the request log keeps the revision each client spoke", async () => {
    const modern = await connectClient(`${harness.url}/mcp/mixed`, token, { pin: MODERN });
    await modern.listTools();
    await modern.close();
    const legacy = await connectClient(`${harness.url}/mcp/mixed`, token);
    await legacy.listTools();
    await legacy.close();

    const endpoint = harness.core.db.select().from(endpoints).where(eq(endpoints.slug, "mixed")).get();
    const rows = harness.core.db
      .select()
      .from(requestLog)
      .where(eq(requestLog.endpointId, endpoint!.id))
      .all();
    const revisions = new Set(rows.map((row) => row.protocol));
    expect(revisions.has(MODERN)).toBe(true);
    expect(revisions.has("2025-11-25")).toBe(true);

    const response = await fetch(`${harness.url}/api/v1/endpoints/${endpoint!.id}/protocols`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    const usage = (await response.json()) as { protocol: string; count: number; lastSeenAt: number }[];
    expect(usage.map((entry) => entry.protocol).sort()).toEqual(["2025-11-25", MODERN]);
    expect(usage.every((entry) => entry.count > 0 && entry.lastSeenAt > 0)).toBe(true);
  });

  test("an upstream that dies on the probe is respawned and spoken to as legacy", async () => {
    const client = await connectClient(`${harness.url}/mcp/fragile`, token);
    const echoed = await client.callTool({ name: "fragile__echo", arguments: { message: "back" } });
    expect(text(echoed)).toBe("fragile: back");
    expect(harness.core.pool.negotiated(fragileUpstream)?.era).toBe("legacy");
    expect(harness.core.supervisor.getInfo(fragileUpstream).state).toBe("running");
    await client.close();
  });
});
