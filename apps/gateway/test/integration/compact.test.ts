import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { requestLog, servers, toolOverrides } from "../../src/db/schema.ts";
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
  harness = await startHarness({ sandbox: { limits: { timeoutMs: 3_000 } } });
});

afterEach(async () => {
  await harness.stop();
});

async function setup(options: { toolMode?: "compact" | "full"; instructions?: string } = {}) {
  const serverId = await seedStdioServer(harness.core, {
    name: "mock",
    env: { MOCK_RICH: "1", ...(options.instructions ? { MOCK_INSTRUCTIONS: options.instructions } : {}) }
  });
  const namespaceId = seedNamespace(harness.core, "default", [{ serverId }]);
  const endpointId = seedEndpoint(harness.core, {
    slug: "default",
    namespaceId,
    toolMode: options.toolMode ?? "compact"
  });
  const token = await seedApiKey(harness.core, endpointId);
  return { serverId, namespaceId, endpointId, token, url: `${harness.url}/mcp/default` };
}

function text(result: CallToolResult, index = 0): string {
  const block = result.content[index];
  return block?.type === "text" ? block.text : "";
}

async function run(client: Awaited<ReturnType<typeof connectClient>>, tool: string, code: string) {
  return (await client.callTool({ name: tool, arguments: { code } })) as CallToolResult;
}

describe("compact tool mode", () => {
  test("lists search and execute with the servers and hints", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token, { pin: "2026-07-28" });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["search", "execute"]);
    const [search, execute] = tools;
    expect(search?.description).toContain("- mock (7 tools)");
    expect(search?.description).toContain("declare function find(query: string, limit?: number): Tool[];");
    expect(search?.annotations?.readOnlyHint).toBe(true);
    expect(execute?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    });
    expect(execute?.description).toContain('await tools.mock__echo({ message: "..." })');
    expect(execute?.inputSchema.required).toEqual(["code"]);
    await client.close();
  }, 20_000);

  test("explains the mode in the instructions", async () => {
    const { url, token } = await setup({ instructions: "Call echo before add." });
    const client = await connectClient(url, token);
    const instructions = client.getInstructions() ?? "";
    expect(instructions.startsWith("This gateway exposes its tools through two tools.")).toBe(true);
    expect(instructions).toContain("## mock\n\nCall echo before add.");
    await client.close();
  }, 20_000);

  test("search returns signatures from the catalog", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const result = await run(client, "search", `async () => find("count words").map((tool) => tool.signature)`);
    expect(result.isError).toBeFalsy();
    const signatures = JSON.parse(text(result)) as string[];
    expect(signatures[0]).toContain("mock__stats(input: {\n  /** Text to count */\n  text: string;\n})");
    expect(signatures[0]).toContain("Promise<{\n  words: number;\n  chars: number;\n}>");

    const servers = await run(client, "search", "async () => servers");
    expect(JSON.parse(text(servers))).toEqual([
      { name: "mock", summary: null, instructions: null, tools: 7, quarantined: false }
    ]);

    const noTools = await run(client, "search", `async () => typeof tools`);
    expect(text(noTools)).toBe("undefined");
    await client.close();
  }, 20_000);

  test("execute calls several tools in one step and logs each call", async () => {
    const { url, token, endpointId, serverId } = await setup();
    const client = await connectClient(url, token, { pin: "2026-07-28" });
    const result = await run(
      client,
      "execute",
      `async () => {
        const [echo, sum, stats] = await Promise.all([
          tools.mock__echo({ message: "hi" }),
          tools.mock__add({ a: 2, b: 3 }),
          tools.mock__stats({ text: "two words" })
        ]);
        console.log("sum is", sum);
        return { echo, sum, stats };
      }`
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({ echo: "mock: hi", sum: 5, stats: { words: 2, chars: 9 } });
    expect(text(result, 1)).toBe("Console output:\nsum is 5");

    const rows = harness.core.db.select().from(requestLog).where(eq(requestLog.endpointId, endpointId)).all();
    const calls = rows.filter((row) => row.method === "tools/call");
    expect(calls.map((row) => row.tool).sort()).toEqual(["execute", "mock__add", "mock__echo", "mock__stats"]);
    expect(calls.find((row) => row.tool === "mock__add")?.serverId).toBe(serverId);
    expect(calls.find((row) => row.tool === "execute")?.serverId).toBeNull();
    await client.close();
  }, 20_000);

  test("a failing tool throws inside the code and reports what already ran", async () => {
    const { url, token, endpointId } = await setup();
    const client = await connectClient(url, token);
    const caught = await run(
      client,
      "execute",
      `async () => { try { await tools.mock__fail({ reason: "disk full" }); } catch (error) { return error.name + ": " + error.message; } }`
    );
    expect(text(caught)).toBe("ToolError: disk full");

    const uncaught = await run(
      client,
      "execute",
      `async () => {
        await tools.mock__echo({ message: "first" });
        await tools.mock__fail({});
      }`
    );
    expect(uncaught.isError).toBe(true);
    expect(text(uncaught)).toStartWith("ToolError: it broke\n\n");
    expect(text(uncaught)).toContain("1 succeeded, 1 failed (mock__echo ok, mock__fail failed)");

    const rows = harness.core.db.select().from(requestLog).where(eq(requestLog.endpointId, endpointId)).all();
    expect(rows.filter((row) => row.tool === "mock__fail").every((row) => row.errorCode === "tool_error")).toBe(true);
    expect(rows.find((row) => row.tool === "execute" && row.status === "error")?.errorCode).toBe("code_error");
    await client.close();
  }, 20_000);

  test("binary content is attached when the code returns its placeholder", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const result = await run(client, "execute", "async () => (await tools.mock__pixel()).content[1]");
    expect(JSON.parse(text(result))).toEqual({ type: "image", mimeType: "image/png", attachment: "attachment-1" });
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });

    const dropped = await run(client, "execute", "async () => (await tools.mock__pixel()).content[0].text");
    expect(dropped.content).toHaveLength(1);
    await client.close();
  }, 20_000);

  test("unknown and disabled tools are refused with a hint", async () => {
    const { url, token, namespaceId, serverId } = await setup();
    harness.core.db.insert(toolOverrides).values({ namespaceId, serverId, toolName: "whoami", enabled: false }).run();
    const client = await connectClient(url, token);
    const typo = await run(client, "execute", "async () => tools.mock__ech({ message: 'x' })");
    expect(text(typo)).toContain('no tool named "mock__ech", did you mean mock__echo?');

    const listed = await run(client, "search", "async () => catalog.map((tool) => tool.name)");
    expect(JSON.parse(text(listed))).not.toContain("mock__whoami");
    const disabled = await run(client, "execute", "async () => tools.mock__whoami()");
    expect(disabled.isError).toBe(true);
    expect(text(disabled)).toContain('no tool named "mock__whoami"');
    await client.close();
  }, 20_000);

  test("runaway code is stopped and the gateway keeps answering", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const loop = run(client, "execute", "async () => { while (true) {} }");
    const health = await fetch(`${harness.url}/health`);
    expect(health.status).toBe(200);
    const result = await loop;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("TimeoutError: the code did not finish within 3 s");

    const slow = await run(client, "execute", "async () => tools.mock__sleep({ ms: 10000 })");
    expect(text(slow)).toContain("did not finish within 3 s");
    await client.close();
  }, 30_000);

  for (const legacy of [false, true]) {
    test(`a ${legacy ? "legacy" : "modern"} client that hangs up stops the run`, async () => {
      const { url, token, endpointId } = await setup();
      const meta = {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": {}
      };
      const headers: Record<string, string> = legacy
        ? { "mcp-protocol-version": "2025-06-18" }
        : { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "execute" };
      const abort = new AbortController();
      const pending = fetch(url, {
        method: "POST",
        signal: abort.signal,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "execute",
            arguments: { code: "async () => tools.mock__sleep({ ms: 2500 })" },
            ...(legacy ? {} : { _meta: meta })
          }
        })
      }).catch(() => null);
      await Bun.sleep(800);
      abort.abort();
      await pending;
      await Bun.sleep(400);
      const rows = harness.core.db.select().from(requestLog).where(eq(requestLog.endpointId, endpointId)).all();
      expect(rows.find((row) => row.tool === "execute")?.errorCode).toBe("code_cancelled");
    }, 20_000);
  }

  test("syntax errors point at the line of the code", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const result = await run(client, "execute", "async () => {\n  const a = ;\n}");
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^SyntaxError: .+ \(line 2, column \d+\)$/);
    const missing = (await client.callTool({ name: "execute", arguments: {} })) as CallToolResult;
    expect(text(missing)).toContain("execute needs a code argument");
    await client.close();
  }, 20_000);

  test("a trailing semicolon after the function still returns its value", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const result = await run(client, "execute", "async () => { return 41 + 1; };");
    expect(text(result)).toBe("42");
    await client.close();
  }, 20_000);

  test("a quarantined server is listed as such and its tools refuse calls", async () => {
    const { url, token, serverId } = await setup();
    harness.core.db
      .update(servers)
      .set({ quarantinedAt: Date.now(), quarantineReason: "test" })
      .where(eq(servers.id, serverId))
      .run();
    const client = await connectClient(url, token);
    const listed = await run(client, "search", "async () => servers");
    expect(JSON.parse(text(listed))).toEqual([
      { name: "mock", summary: null, instructions: null, tools: 0, quarantined: true }
    ]);
    const blocked = await run(client, "execute", "async () => tools.mock__echo({ message: 'x' })");
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain('no tool named "mock__echo"');
    const direct = (await client.callTool({ name: "mock__echo", arguments: { message: "x" } })) as CallToolResult;
    expect(direct.isError).toBe(true);
    expect(text(direct)).toContain("quarantined");
    await client.close();
  }, 20_000);

  test("direct calls by catalog name keep working in compact mode", async () => {
    const { url, token } = await setup();
    const client = await connectClient(url, token);
    const result = (await client.callTool({ name: "mock__echo", arguments: { message: "direct" } })) as CallToolResult;
    expect(text(result)).toBe("mock: direct");
    await client.close();
  }, 20_000);

  test("the tools query parameter overrides the endpoint mode", async () => {
    const { url, token } = await setup({ toolMode: "full" });
    const full = await connectClient(url, token);
    expect((await full.listTools()).tools.map((tool) => tool.name)).toContain("mock__echo");
    await full.close();

    const compact = await connectClient(`${url}?tools=compact`, token);
    expect((await compact.listTools()).tools.map((tool) => tool.name)).toEqual(["search", "execute"]);
    await compact.close();

    const response = await fetch(`${url}?tools=tiny`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(400);
  }, 20_000);

  test("full mode does not answer search or execute", async () => {
    const { url, token } = await setup({ toolMode: "full" });
    const client = await connectClient(url, token);
    await expect(client.callTool({ name: "execute", arguments: { code: "1" } })).rejects.toThrow(/unknown tool/);
    await client.close();
  }, 20_000);
});
