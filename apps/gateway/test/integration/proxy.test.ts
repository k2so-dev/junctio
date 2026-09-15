import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  connectClient,
  seedApiKey,
  seedEndpoint,
  seedNamespace,
  seedStdioServer,
  startHarness,
  type Harness
} from "../helpers.ts";

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.stop();
});

async function setup(options: { authMode?: "none" | "api_key" } = {}) {
  const serverId = await seedStdioServer(harness.core, { name: "mock" });
  const namespaceId = seedNamespace(harness.core, "default", [{ serverId }]);
  const endpointId = seedEndpoint(harness.core, {
    slug: "default",
    namespaceId,
    authMode: options.authMode ?? "api_key"
  });
  const token = options.authMode === "none" ? null : await seedApiKey(harness.core, endpointId);
  return { serverId, namespaceId, endpointId, token, url: `${harness.url}/mcp/default` };
}

describe("mcp proxy", () => {
  test("lists prefixed tools from the upstream", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["mock__add", "mock__echo", "mock__whoami"]);
    const add = tools.find((tool) => tool.name === "mock__add");
    expect(add?.annotations?.readOnlyHint).toBe(true);
    expect(add?.inputSchema.type).toBe("object");
    await client.close();
  }, 20_000);

  test("calls a tool through the gateway", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const result = await client.callTool({ name: "mock__echo", arguments: { message: "hi" } });
    expect(result.content).toEqual([{ type: "text", text: "mock: hi" }]);
    await client.close();
  }, 20_000);

  test("reports an unknown tool as an invalid params error", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const unknownUpstreamTool = await client.callTool({ name: "mock__nope", arguments: {} });
    expect(unknownUpstreamTool.isError).toBe(true);
    await expect(client.callTool({ name: "other__echo", arguments: {} })).rejects.toThrow(/unknown tool/);
    await client.close();
  }, 20_000);

  test("aggregates resources and prompts with a prefix", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["mock+mock://readme"]);
    const read = await client.readResource({ uri: "mock+mock://readme" });
    expect((read.contents[0] as { text: string }).text).toBe("readme of mock");
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["mock__greet"]);
    const prompt = await client.getPrompt({ name: "mock__greet", arguments: { who: "bob" } });
    expect((prompt.messages[0]?.content as { text: string }).text).toBe("Hello bob");
    await client.close();
  }, 20_000);

  test("merges two upstreams under distinct prefixes", async () => {
    const first = await seedStdioServer(harness.core, { name: "alpha" });
    const second = await seedStdioServer(harness.core, { name: "beta" });
    const namespaceId = seedNamespace(harness.core, "multi", [{ serverId: first }, { serverId: second }]);
    const endpointId = seedEndpoint(harness.core, { slug: "multi", namespaceId });
    const token = await seedApiKey(harness.core, endpointId);
    const client = await connectClient(`${harness.url}/mcp/multi`, token);
    const { tools } = await client.listTools();
    expect(tools.filter((t) => t.name.startsWith("alpha__"))).toHaveLength(3);
    expect(tools.filter((t) => t.name.startsWith("beta__"))).toHaveLength(3);
    const result = await client.callTool({ name: "beta__echo", arguments: { message: "x" } });
    expect(result.content).toEqual([{ type: "text", text: "beta: x" }]);
    await client.close();
  }, 30_000);

  test("keeps working when one upstream is dead", async () => {
    const good = await seedStdioServer(harness.core, { name: "good" });
    const bad = await seedStdioServer(harness.core, { name: "bad", env: { MOCK_EXIT_IMMEDIATELY: "1" } });
    const namespaceId = seedNamespace(harness.core, "mixed", [{ serverId: good }, { serverId: bad }]);
    const endpointId = seedEndpoint(harness.core, { slug: "mixed", namespaceId });
    const token = await seedApiKey(harness.core, endpointId);
    const client = await connectClient(`${harness.url}/mcp/mixed`, token);
    const started = Date.now();
    const { tools } = await client.listTools();
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(tools.every((tool) => tool.name.startsWith("good__"))).toBe(true);
    expect(tools).toHaveLength(3);
    await client.close();
  }, 30_000);

  test("passes the configured environment to the child process", async () => {
    const serverId = await seedStdioServer(harness.core, { name: "mock", env: { MOCK_TOKEN: "from-config" } });
    const namespaceId = seedNamespace(harness.core, "envns", [{ serverId }]);
    const endpointId = seedEndpoint(harness.core, { slug: "envns", namespaceId });
    const token = await seedApiKey(harness.core, endpointId);
    const client = await connectClient(`${harness.url}/mcp/envns`, token);
    const result = await client.callTool({ name: "mock__whoami", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "from-config" }]);
    await client.close();
  }, 20_000);
});

describe("endpoint auth", () => {
  test("rejects a request without a key", async () => {
    await setup();
    const response = await fetch(`${harness.url}/mcp/default`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(response.headers.get("www-authenticate")).not.toContain("resource_metadata");
  });

  test("rejects an unknown key", async () => {
    await setup();
    const response = await fetch(`${harness.url}/mcp/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer jn_deadbeefdeadbeefdeadbeef"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(401);
  });

  test("accepts the key in the x-api-key header", async () => {
    const { token } = await setup();
    const response = await fetch(`${harness.url}/mcp/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-api-key": token as string
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }
      })
    });
    expect(response.status).toBe(200);
  });

  test("allows an endpoint with auth mode none", async () => {
    const { url } = await setup({ authMode: "none" });
    const client = await connectClient(url, null);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  }, 20_000);

  test("rejects a key bound to another endpoint", async () => {
    const { namespaceId } = await setup();
    const otherId = seedEndpoint(harness.core, { slug: "other", namespaceId });
    const otherToken = await seedApiKey(harness.core, otherId);
    const response = await fetch(`${harness.url}/mcp/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${otherToken}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(403);
  });

  test("returns 404 for an unknown endpoint", async () => {
    const response = await fetch(`${harness.url}/mcp/nope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(404);
  });

  test("rejects a foreign origin", async () => {
    const { token } = await setup();
    const response = await fetch(`${harness.url}/mcp/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(403);
  });

  test("rejects a foreign localhost origin", async () => {
    const { token } = await setup();
    const response = await fetch(`${harness.url}/mcp/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:9999",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(403);
  });

  test("rejects GET on the mcp endpoint", async () => {
    const { token } = await setup();
    const response = await fetch(`${harness.url}/mcp/default`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(405);
  });
});

describe("health", () => {
  test("reports server counts", async () => {
    await setup();
    const response = await fetch(`${harness.url}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; servers: { total: number } };
    expect(body.status).toBe("ok");
    expect(body.servers.total).toBe(1);
  });
});
