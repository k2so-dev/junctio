import { describe, expect, test } from "bun:test";
import { memberAccess, propertyKey, schemaType, toolSignature } from "../../src/compact/signature.ts";

describe("schemaType", () => {
  test("wraps a nullable object in parentheses inside an array", () => {
    const type = schemaType({
      type: "array",
      items: { anyOf: [{ type: "object", properties: { id: { type: "string" } } }, { type: "null" }] }
    });
    expect(type).toBe("({\n  id?: string;\n} | null)[]");
  });

  test("a quote or bracket in a property description does not hide the union", () => {
    const type = schemaType({
      type: "array",
      items: {
        anyOf: [
          { type: "object", properties: { w: { type: "number", description: 'width (e.g. 12" < 20' } } },
          { type: "null" }
        ]
      }
    });
    expect(type).toBe('({\n  /** width (e.g. 12" < 20 */\n  w?: number;\n} | null)[]');
  });

  test("wraps an intersection in parentheses inside an array", () => {
    const type = schemaType({
      type: "array",
      items: {
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "string" } } }
        ]
      }
    });
    expect(type).toBe("({\n  a?: string;\n} & {\n  b?: string;\n})[]");
  });

  test("a malformed escape in a reference does not throw", () => {
    const type = schemaType({ type: "object", properties: { a: { $ref: "#/$defs/100%" } }, $defs: {} });
    expect(type).toBe("{\n  a?: unknown;\n}");
  });

  test("renders objects with optional members and property docs", () => {
    const type = schemaType({
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        "per-page": { type: "number" }
      },
      required: ["repo"]
    });
    expect(type).toBe(
      [
        "{",
        "  /** owner/name */",
        "  repo: string;",
        "  /**",
        "   * min 1, max 100",
        "   * @default 30",
        "   */",
        "  limit?: number;",
        '  "per-page"?: number;',
        "}"
      ].join("\n")
    );
  });

  test("covers enums, unions, arrays, tuples and nullables", () => {
    expect(schemaType({ enum: ["open", "closed", null] })).toBe('"open" | "closed" | null');
    expect(schemaType({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
    expect(schemaType({ type: ["string", "null"] })).toBe("string | null");
    expect(schemaType({ type: "array", items: { enum: ["a", "b"] } })).toBe('("a" | "b")[]');
    expect(schemaType({ type: "array", prefixItems: [{ type: "string" }, { type: "number" }] })).toBe(
      "[string, number]"
    );
    expect(schemaType({ type: "string", nullable: true })).toBe("string | null");
    expect(schemaType({ const: 3 })).toBe("3");
    expect(schemaType({ type: "object", additionalProperties: { type: "number" } })).toBe(
      "{\n  [key: string]: number;\n}"
    );
    expect(schemaType({ type: "object" })).toBe("Record<string, unknown>");
    expect(schemaType(true)).toBe("unknown");
    expect(schemaType(false)).toBe("never");
  });

  test("follows local refs and stops on cycles", () => {
    const schema = {
      type: "object",
      properties: { node: { $ref: "#/$defs/node" } },
      $defs: { node: { type: "object", properties: { next: { $ref: "#/$defs/node" } } } }
    };
    const type = schemaType(schema);
    expect(type).toContain("next?:");
    expect(type).toContain("unknown");
    expect(schemaType({ $ref: "https://example.com/schema.json" })).toBe("unknown");
  });

  test("escapes comment terminators in descriptions", () => {
    const type = schemaType({ type: "object", properties: { a: { type: "string", description: "ends */ here" } } });
    expect(type).toContain("ends *\\/ here");
  });
});

describe("toolSignature", () => {
  test("puts title, description and behaviour in the doc comment", () => {
    const signature = toolSignature({
      name: "github__list_issues",
      title: "List issues",
      description: "Lists the issues of a repository.\nNewest first.",
      inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
      annotations: { readOnlyHint: true }
    });
    expect(signature).toBe(
      [
        "/**",
        " * List issues.",
        " * Lists the issues of a repository.",
        " * Newest first.",
        " * Read-only.",
        " */",
        "github__list_issues(input: {",
        "  repo: string;",
        "}): Promise<unknown>;"
      ].join("\n")
    );
  });

  test("marks the input optional when nothing is required and types the output schema", () => {
    const signature = toolSignature({
      name: "x-y",
      description: "Counts",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { count: { type: "number" } }, required: ["count"] }
    });
    expect(signature).toBe('/** Counts */\n"x-y"(input?: {}): Promise<{\n  count: number;\n}>;');
  });

  test("skips the title when the description already starts with it", () => {
    const signature = toolSignature({ name: "a", title: "Echo", description: "Echo a message", inputSchema: {} });
    expect(signature.startsWith("/** Echo a message */")).toBe(true);
  });
});

describe("names", () => {
  test("quotes keys that are not identifiers", () => {
    expect(propertyKey("plain_name")).toBe("plain_name");
    expect(propertyKey("with-dash")).toBe('"with-dash"');
    expect(memberAccess("plain")).toBe(".plain");
    expect(memberAccess("a.b")).toBe('["a.b"]');
  });
});
