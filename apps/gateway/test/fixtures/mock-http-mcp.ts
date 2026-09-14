import { createRemoteJWKSet, jwtVerify } from "jose";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

export type MockHttpMcpOptions = {
  name?: string;
  issuer: string | null;
  requireAuth?: boolean;
  modern?: boolean;
};

export type MockHttpMcp = {
  url: string;
  counts: { requests: number; unauthorized: number; toolCalls: number; eras: { legacy: number; modern: number } };
  seenTokens: string[];
  stop(): Promise<void>;
};

export async function startMockHttpMcp(options: MockHttpMcpOptions): Promise<MockHttpMcp> {
  const name = options.name ?? "remote";
  const requireAuth = options.requireAuth ?? true;
  const counts = { requests: 0, unauthorized: 0, toolCalls: 0, eras: { legacy: 0, modern: 0 } };
  const seenTokens: string[] = [];
  const jwks = options.issuer ? createRemoteJWKSet(new URL(`${options.issuer}/jwks.json`)) : null;
  let selfUrl = "";

  function buildLegacyServer(): Server {
    const server = new Server({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "ping",
          description: "Returns pong",
          inputSchema: { type: "object", properties: {}, additionalProperties: false }
        }
      ]
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      counts.toolCalls += 1;
      return { content: [{ type: "text", text: "pong" }] };
    });
    return server;
  }

  const modernHandler = options.modern
    ? createMcpHandler(({ era }) => {
        counts.eras[era] += 1;
        const server = new McpServer({ name, version: "2.0.0" });
        server.registerTool("ping", { description: "Returns pong" }, async () => {
          counts.toolCalls += 1;
          return { content: [{ type: "text", text: `pong (${era})` }] };
        });
        return server;
      })
    : null;

  function unauthorized(): Response {
    counts.unauthorized += 1;
    return new Response(JSON.stringify({ error: "invalid_token" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${selfUrl}/.well-known/oauth-protected-resource"`
      }
    });
  }

  const httpServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return Response.json({
          resource: `${selfUrl}/mcp`,
          authorization_servers: options.issuer ? [options.issuer] : [],
          bearer_methods_supported: ["header"]
        });
      }

      if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
      counts.requests += 1;

      if (requireAuth) {
        const header = request.headers.get("authorization") ?? "";
        const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
        if (!token || !jwks) return unauthorized();
        seenTokens.push(token);
        try {
          await jwtVerify(token, jwks, { issuer: options.issuer ?? undefined });
        } catch {
          return unauthorized();
        }
      }

      if (modernHandler) return modernHandler.fetch(request);

      const server = buildLegacyServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });
      try {
        await server.connect(transport);
        return await transport.handleRequest(request);
      } finally {
        void transport.close();
        void server.close();
      }
    }
  });

  selfUrl = `http://127.0.0.1:${httpServer.port}`;

  return {
    url: `${selfUrl}/mcp`,
    counts,
    seenTokens,
    async stop() {
      await modernHandler?.close();
      await httpServer.stop(true);
    }
  };
}
