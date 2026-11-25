import { afterEach, describe, expect, test } from "bun:test";
import { buildCatalog } from "../../src/compact/catalog.ts";
import { Sandbox } from "../../src/compact/sandbox.ts";

let sandbox: Sandbox | null = null;

afterEach(() => {
  sandbox?.close();
  sandbox = null;
});

function catalogOf(count: number) {
  const tools = Array.from({ length: count }, (_, index) => ({
    serverId: "s1",
    originalName: `tool_${index}`,
    tool: {
      name: `big__tool_${index}`,
      description: `Tool number ${index}. ${"Reads a record of the remote service. ".repeat(20)}`,
      inputSchema: { type: "object" as const, properties: { id: { type: "string", description: "Record id" } } }
    }
  }));
  return buildCatalog(tools, [{ serverId: "s1", prefix: "big", quarantined: false, text: null }]);
}

describe("compact sandbox and large catalogs", () => {
  test("a catalog larger than the memory limit leaves the code its full budget", async () => {
    sandbox = new Sandbox({ limits: { memoryBytes: 4 * 1024 * 1024 } });
    const outcome = await sandbox.run({
      mode: "search",
      code: `async () => [catalog.length, find("tool 1234", 1)[0].name]`,
      catalog: catalogOf(5_000)
    });
    expect(outcome).toMatchObject({ ok: true, value: [5_000, "big__tool_1234"] });
  }, 30_000);

  test("a catalog over the size limit is refused before a process starts", async () => {
    sandbox = new Sandbox({ limits: { maxCatalogChars: 100_000 } });
    const outcome = await sandbox.run({ mode: "search", code: "async () => 1", catalog: catalogOf(200) });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe("catalog");
    expect(outcome.error.message).toContain("too large for compact mode (200 tools");
    expect(outcome.durationMs).toBeLessThan(1_000);
  });
});
