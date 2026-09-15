import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const name = Bun.env.MOCK_NAME ?? "mock-modern";
const legacy = Bun.env.MOCK_LEGACY === "reject" ? "reject" : "serve";

serveStdio(
  ({ era }) => {
    const server = new McpServer({ name, version: "2.0.0" });
    server.registerTool(
      "echo",
      { title: "Echo", description: "Echoes the provided message", inputSchema: z.object({ message: z.string() }) },
      async ({ message }) => ({ content: [{ type: "text", text: `${name}: ${message}` }] })
    );
    server.registerTool(
      "era",
      { title: "Era", description: "Reports the protocol era of the connection" },
      async () => ({
        content: [{ type: "text", text: era }]
      })
    );
    return server;
  },
  { legacy }
);

process.stderr.write(`mock modern server ${name} ready\n`);
