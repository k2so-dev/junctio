import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const name = Bun.env.MOCK_NAME ?? "mock-stdio";
const crashAfterMs = Number(Bun.env.MOCK_CRASH_AFTER_MS ?? "0");
const exitImmediately = Bun.env.MOCK_EXIT_IMMEDIATELY === "1";

if (exitImmediately) {
  process.stderr.write("mock server refusing to start\n");
  process.exit(2);
}

const server = new McpServer({ name, version: "1.0.0" });

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Echoes the provided message",
    inputSchema: { message: z.string() }
  },
  async ({ message }) => ({ content: [{ type: "text", text: `${name}: ${message}` }] })
);

server.registerTool(
  "add",
  {
    title: "Add",
    description: "Adds two numbers",
    inputSchema: { a: z.number(), b: z.number() },
    annotations: { readOnlyHint: true }
  },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] })
);

server.registerTool(
  "whoami",
  {
    title: "Who am I",
    description: "Returns the value of the MOCK_TOKEN environment variable",
    inputSchema: {}
  },
  async () => ({ content: [{ type: "text", text: Bun.env.MOCK_TOKEN ?? "none" }] })
);

server.registerResource(
  "readme",
  "mock://readme",
  { title: "Readme", mimeType: "text/plain" },
  async (uri) => ({ contents: [{ uri: uri.href, text: `readme of ${name}` }] })
);

server.registerPrompt(
  "greet",
  { title: "Greet", description: "Greets a person", argsSchema: { who: z.string() } },
  ({ who }) => ({ messages: [{ role: "user", content: { type: "text", text: `Hello ${who}` } }] })
);

process.stderr.write(`mock server ${name} ready\n`);

if (crashAfterMs > 0) {
  setTimeout(() => process.exit(3), crashAfterMs);
}

await server.connect(new StdioServerTransport());
