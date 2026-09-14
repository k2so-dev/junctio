import { afterEach, describe, expect, test } from "bun:test";
import {
  connectClient,
  seedApiKey,
  seedEndpoint,
  seedHttpServer,
  seedNamespace,
  startHarness,
  type Harness
} from "../helpers.ts";
import { startMockSseMcp, type MockSseMcp } from "../fixtures/mock-sse-mcp.ts";

let harness: Harness;
let upstream: MockSseMcp;

const ADMIN_TOKEN = "token-0123456789abcdef";

async function setup(options: { token?: string } = {}) {
  upstream = await startMockSseMcp(options.token ? { token: options.token } : {});
  harness = await startHarness({ env: { JUNCTIO_ADMIN_TOKEN: ADMIN_TOKEN } });
  const serverId = await seedHttpServer(harness.core, {
    name: "legacy",
    url: upstream.url,
    transport: "sse",
    ...(options.token
      ? { authMode: "header" as const, headers: { Authorization: `Bearer ${options.token}` } }
      : {})
  });
  const namespaceId = seedNamespace(harness.core, "ns", [{ serverId }]);
  const endpointId = seedEndpoint(harness.core, { slug: "gw", namespaceId });
  const token = await seedApiKey(harness.core, endpointId);
  return { serverId, token, url: `${harness.url}/mcp/gw` };
}

afterEach(async () => {
  await harness?.stop();
  await upstream?.stop();
});

describe("sse upstream", () => {
  test("lists and calls a tool over a legacy sse stream", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["legacy__ping"]);

    const result = (await client.callTool({ name: "legacy__ping", arguments: {} })) as {
      content: { text: string }[];
    };
    expect(result.content[0]?.text).toBe("pong");
    expect(upstream.counts.toolCalls).toBe(1);
    expect(upstream.counts.streams).toBe(1);

    await client.close();
  }, 20_000);

  test("negotiates the legacy era with an sse upstream", async () => {
    const { serverId } = await setup();
    await harness.core.pool.catalog(serverId);

    const negotiated = harness.core.pool.negotiated(serverId);
    expect(negotiated?.era).toBe("legacy");
    expect(negotiated?.protocolVersion).toBeTruthy();
  }, 20_000);

  test("sends the stored authorization header on the stream and the posts", async () => {
    const { url, token } = await setup({ token: "sse-secret" });
    const client = await connectClient(url, token);

    await client.callTool({ name: "legacy__ping", arguments: {} });

    expect(upstream.counts.unauthorized).toBe(0);
    expect(upstream.counts.posts).toBeGreaterThan(0);
    expect(new Set(upstream.seenTokens)).toEqual(new Set(["sse-secret"]));

    await client.close();
  }, 20_000);

  test("reopens the stream on the next call after the upstream drops it", async () => {
    const { serverId, url, token } = await setup();
    const client = await connectClient(url, token);

    await client.callTool({ name: "legacy__ping", arguments: {} });
    expect(upstream.counts.streams).toBe(1);

    upstream.dropStreams();
    await Bun.sleep(150);

    const notice = harness.core.logs.tail(serverId).map((entry) => entry.line);
    expect(notice.some((text) => text.includes("sse stream dropped"))).toBe(true);

    const result = (await client.callTool({ name: "legacy__ping", arguments: {} })) as {
      content: { text: string }[];
    };
    expect(result.content[0]?.text).toBe("pong");
    expect(upstream.counts.streams).toBeGreaterThan(1);
    expect(upstream.counts.toolCalls).toBe(2);

    await client.close();
  }, 20_000);

  test("reports an sse upstream as reachable through the connection test", async () => {
    const { serverId } = await setup();
    const response = await fetch(`${harness.url}/api/v1/servers/${serverId}/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    const result = (await response.json()) as { ok: boolean; toolCount: number | null };
    expect(result.ok).toBe(true);
    expect(result.toolCount).toBe(1);
  }, 20_000);
});
