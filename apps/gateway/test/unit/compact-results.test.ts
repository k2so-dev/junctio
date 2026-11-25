import { describe, expect, test } from "bun:test";
import { Attachments, render, sandboxValue, ToolError } from "../../src/compact/results.ts";
import { buildCatalog, executeHints, summarize } from "../../src/compact/catalog.ts";

describe("sandboxValue", () => {
  test("prefers structured content, then parsed text", () => {
    const attachments = new Attachments();
    expect(
      sandboxValue({ content: [{ type: "text", text: "{}" }], structuredContent: { words: 2 } }, attachments)
    ).toEqual({ words: 2 });
    expect(sandboxValue({ content: [{ type: "text", text: '{"a":1}' }] }, attachments)).toEqual({ a: 1 });
    expect(sandboxValue({ content: [{ type: "text", text: "plain words" }] }, attachments)).toBe("plain words");
    expect(sandboxValue({ content: [] }, attachments)).toBeNull();
  });

  test("throws the tool message on an error result", () => {
    expect(() => sandboxValue({ content: [{ type: "text", text: "nope" }], isError: true }, new Attachments())).toThrow(
      ToolError
    );
  });

  test("turns binary content into attachment placeholders", () => {
    const attachments = new Attachments();
    const value = sandboxValue(
      {
        content: [
          { type: "text", text: "a pixel" },
          { type: "image", mimeType: "image/png", data: "AAAA" },
          { type: "resource", resource: { uri: "file:///a.txt", mimeType: "text/plain", text: "inline" } }
        ]
      },
      attachments
    );
    expect(value).toEqual({
      content: [
        { type: "text", text: "a pixel" },
        { type: "image", mimeType: "image/png", attachment: "attachment-1" },
        { type: "resource", uri: "file:///a.txt", mimeType: "text/plain", text: "inline" }
      ]
    });
    expect(attachments.referencedBy({ nested: [{ attachment: "attachment-1" }] })).toEqual([
      { type: "image", mimeType: "image/png", data: "AAAA" }
    ]);
    expect(attachments.referencedBy({ attachment: "attachment-9" })).toEqual([]);
  });
});

describe("render", () => {
  test("keeps small values and pretty prints them", () => {
    expect(render({ a: 1 })).toEqual({ text: '{\n  "a": 1\n}', truncated: false });
    expect(render("text")).toEqual({ text: "text", truncated: false });
  });

  test("cuts large values and keeps them valid JSON", () => {
    const value = Array.from({ length: 2000 }, (_, index) => ({ index, body: "x".repeat(200) }));
    const { text, truncated } = render(value, 5000);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(5000);
    const parsed = JSON.parse(text) as unknown[];
    expect(parsed.at(-1)).toMatch(/more items/);
  });
});

describe("catalog", () => {
  const tools = [
    {
      serverId: "s1",
      originalName: "read",
      tool: { name: "a__read", inputSchema: { type: "object" as const }, annotations: { readOnlyHint: true } }
    },
    { serverId: "s2", originalName: "write", tool: { name: "b__write", inputSchema: { type: "object" as const } } }
  ];

  test("groups tools by server and summarizes instructions", () => {
    const catalog = buildCatalog(tools, [
      { serverId: "s1", prefix: "a", quarantined: false, text: "## Usage\n\nReads things. Second sentence." },
      { serverId: "s2", prefix: "b", quarantined: true, text: "secret" }
    ]);
    expect(catalog.servers).toEqual([
      {
        name: "a",
        summary: "Reads things. Second sentence.",
        instructions: "## Usage\n\nReads things. Second sentence.",
        tools: 1,
        quarantined: false
      },
      { name: "b", summary: null, instructions: null, tools: 1, quarantined: true }
    ]);
    expect(catalog.tools[0]?.signature).toContain("a__read(input?: Record<string, unknown>)");
  });

  test("summaries stop at a sentence when the paragraph is long", () => {
    const long = `${"Word ".repeat(20)}ends here. ${"More ".repeat(40)}`;
    expect(summarize(long)).toBe(`${"Word ".repeat(20)}ends here.`);
    expect(summarize(null)).toBeNull();
  });

  test("execute is read-only only when every tool is", () => {
    const catalog = buildCatalog(tools, []);
    expect(executeHints(catalog.tools)).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    });
    expect(executeHints(catalog.tools.slice(0, 1)).readOnlyHint).toBe(true);
  });
});
