import type { Tool } from "@modelcontextprotocol/client";
import { executeHints, type Catalog } from "./catalog.ts";
import { memberAccess, propertyKey } from "./signature.ts";
import type { SandboxLimits } from "./sandbox.ts";

export const SEARCH_TOOL = "search";
export const EXECUTE_TOOL = "execute";

const LISTED_SERVERS = 40;

export const CATALOG_TYPES = `interface Tool {
  /** Name to call in execute: tools[name](input) */
  name: string;
  /** Server the tool belongs to */
  server: string;
  title?: string;
  description: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  inputSchema: object;
  outputSchema?: object;
  /** TypeScript declaration of the tool with its description and parameter docs */
  signature: string;
}

interface Server {
  name: string;
  /** First paragraph of the server's instructions */
  summary: string | null;
  instructions: string | null;
  tools: number;
  /** A quarantined server refuses calls until a security audit clears it */
  quarantined: boolean;
}

declare const catalog: Tool[];
declare const servers: Server[];
/** Tools ranked by how well their name, title, server and description match the words of the query */
declare function find(query: string, limit?: number): Tool[];`;

const CODE_PROPERTY = {
  type: "string",
  description: "JavaScript: an async arrow function, or a function body that ends with return"
};

function serverLines(catalog: Catalog): string {
  if (catalog.servers.length === 0) return "No servers are connected to this endpoint yet.";
  const listed = catalog.servers.slice(0, LISTED_SERVERS).map((server) => {
    const state = server.quarantined ? "quarantined" : `${server.tools} ${server.tools === 1 ? "tool" : "tools"}`;
    return `- ${server.name} (${state})${server.summary ? `: ${server.summary}` : ""}`;
  });
  const rest = catalog.servers.length - LISTED_SERVERS;
  if (rest > 0) listed.push(`- and ${rest} more, list them with servers`);
  return listed.join("\n");
}

function placeholderFor(schema: unknown): string {
  const type = typeof schema === "object" && schema !== null ? (schema as { type?: unknown }).type : undefined;
  if (type === "number" || type === "integer") return "1";
  if (type === "boolean") return "true";
  if (type === "array") return "[]";
  if (type === "object") return "{}";
  return '"..."';
}

export function exampleCall(catalog: Catalog, separator: string): string {
  const tool = catalog.tools[0];
  if (!tool) return `tools${memberAccess(`github${separator}list_issues`)}({ repo: "owner/name" })`;
  const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: unknown };
  const required = Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [];
  const args = required
    .slice(0, 4)
    .map((key) => `${propertyKey(key)}: ${placeholderFor(schema.properties?.[key])}`)
    .join(", ");
  return `tools${memberAccess(tool.name)}(${args === "" ? "" : `{ ${args} }`})`;
}

export function searchDescription(catalog: Catalog): string {
  return `Find the tools of this gateway by running JavaScript against its catalog. Nothing is called here; run tools with execute.

Servers:
${serverLines(catalog)}

Write an async arrow function that returns what you need. Prefer returning signatures over whole schemas: they are shorter and carry every description.

Available:
${CATALOG_TYPES}

Examples:

// Best matches for a few words
async () => find("open pull requests").map((tool) => tool.signature)

// Every tool of one server, names and titles only
async () => catalog.filter((tool) => tool.server === ${JSON.stringify(catalog.servers[0]?.name ?? "github")}).map((tool) => [tool.name, tool.title])

// Tools that only read
async () => catalog.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name)`;
}

export function executeDescription(catalog: Catalog, separator: string, limits: SandboxLimits): string {
  const call = exampleCall(catalog, separator);
  return `Run JavaScript that calls the tools of this gateway. Look tools up with search first, unless you already know their signatures.

Write an async arrow function. Call a tool with await tools[name](input), or tools.name(input) when the name is a plain identifier, passing one object that matches its signature. A tool returns its structured content when it declares an output schema, otherwise its text, parsed as JSON when it is JSON. A failing tool throws an Error with the tool's message. Images, audio and binary resources come back as { type, mimeType, attachment } placeholders: return a placeholder and the file is attached to the result.

Start independent calls together with Promise.all. Whatever console.log prints is returned next to the result. The code has no network, file system or timers, only tools, catalog, servers and find from search. Calls still running when the function returns are cancelled.

Limits per run: ${limits.maxCalls} tool calls, ${Math.round(limits.timeoutMs / 1000)} s. Results longer than about 6,000 tokens are cut, so return only what you need.

Example:
async () => {
  const result = await ${call};
  return result;
}`;
}

export function compactTools(catalog: Catalog, separator: string, limits: SandboxLimits): Tool[] {
  return [
    {
      name: SEARCH_TOOL,
      title: "Search tools",
      description: searchDescription(catalog),
      inputSchema: {
        type: "object",
        properties: { code: CODE_PROPERTY },
        required: ["code"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: EXECUTE_TOOL,
      title: "Run tools",
      description: executeDescription(catalog, separator, limits),
      inputSchema: {
        type: "object",
        properties: { code: CODE_PROPERTY },
        required: ["code"],
        additionalProperties: false
      },
      annotations: executeHints(catalog.tools)
    }
  ];
}

export const COMPACT_PREAMBLE = `This gateway exposes its tools through two tools. search runs JavaScript against the tool catalog and returns signatures; execute runs JavaScript that calls the tools, so several calls fit in one step. Tool names mentioned below are catalog names: call them inside execute as tools[name](input).`;

export function compactInstructions(instructions: string | undefined): string {
  return instructions ? `${COMPACT_PREAMBLE}\n\n${instructions}` : COMPACT_PREAMBLE;
}
