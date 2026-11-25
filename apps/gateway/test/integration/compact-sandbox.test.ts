import { afterEach, describe, expect, test } from "bun:test";
import { buildCatalog } from "../../src/compact/catalog.ts";
import { Sandbox } from "../../src/compact/sandbox.ts";

let sandbox: Sandbox | null = null;

afterEach(() => {
  sandbox?.close();
  sandbox = null;
});

function catalogOf(count: number, sentence = "Reads a record of the remote service. ") {
  const tools = Array.from({ length: count }, (_, index) => ({
    serverId: "s1",
    originalName: `tool_${index}`,
    tool: {
      name: `big__tool_${index}`,
      description: `Tool number ${index}. ${sentence.repeat(20)}`,
      inputSchema: { type: "object" as const, properties: { id: { type: "string", description: "Record id" } } }
    }
  }));
  return buildCatalog(tools, [{ serverId: "s1", prefix: "big", quarantined: false, text: null }]);
}

describe("compact sandbox and large catalogs", () => {
  for (const [script, sentence] of [
    ["latin", "Reads a record of the remote service. "],
    ["cyrillic", "Читает запись удалённого сервиса. "]
  ] as const) {
    test(`a ${script} catalog larger than the memory limit leaves the code its full budget`, async () => {
      sandbox = new Sandbox({ limits: { memoryBytes: 4 * 1024 * 1024 } });
      const outcome = await sandbox.run({
        mode: "search",
        code: `async () => { const name = find("tool 1234", 1)[0].name; const kept = "x".repeat(3 * 1024 * 1024); return [catalog.length, name, kept.length]; }`,
        catalog: catalogOf(5_000, sentence)
      });
      expect(outcome).toMatchObject({ ok: true, value: [5_000, "big__tool_1234", 3 * 1024 * 1024] });
    }, 30_000);
  }

  test("code that keeps allocating still runs out of memory next to a large catalog", async () => {
    sandbox = new Sandbox({ limits: { memoryBytes: 4 * 1024 * 1024 } });
    const outcome = await sandbox.run({
      mode: "search",
      code: `async () => { const kept = []; for (let i = 0; ; i++) kept.push({ i, text: "value " + i }); }`,
      catalog: catalogOf(5_000)
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain("out of memory");
  }, 30_000);

  test("find keeps working after the code reorders or extends the catalog", async () => {
    sandbox = new Sandbox();
    const outcome = await sandbox.run({
      mode: "search",
      code: `async () => { catalog.reverse(); catalog.push({ name: "extra" }); return find("tool 7", 1)[0].name; }`,
      catalog: catalogOf(10)
    });
    expect(outcome).toMatchObject({ ok: true, value: "big__tool_7" });
  });

  test("a catalog over the size limit is refused before a process starts", async () => {
    sandbox = new Sandbox({ limits: { maxCatalogBytes: 100_000 } });
    const outcome = await sandbox.run({ mode: "search", code: "async () => 1", catalog: catalogOf(200) });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe("catalog");
    expect(outcome.error.message).toContain("too large for compact mode (200 tools");
    expect(outcome.durationMs).toBeLessThan(1_000);
  });
});
