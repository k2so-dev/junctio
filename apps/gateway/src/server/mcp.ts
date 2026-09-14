import { Hono } from "hono";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import type { Core } from "../core.ts";
import { VERSION } from "../config.ts";
import type { EndpointRow } from "../db/schema.ts";
import { authenticateEndpoint, challengeHeader, endpointBySlug, type JwtVerifier } from "../auth/downstream/middleware.ts";
import { recordRequest } from "./requestlog.ts";
import { checkOrigin } from "./origin.ts";
import { UpstreamError } from "../upstream/types.ts";

export type McpRouteOptions = {
  core: Core;
  verifier: JwtVerifier | null;
};

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function buildServer(core: Core, endpoint: EndpointRow): Server {
  const server = new Server(
    { name: "junctio", version: VERSION },
    { capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} } }
  );
  const { aggregator } = core;
  const namespaceId = endpoint.namespaceId;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const started = Date.now();
    const tools = await aggregator.listTools(namespaceId);
    recordRequest(core, {
      endpointId: endpoint.id,
      serverId: null,
      method: "tools/list",
      tool: null,
      durationMs: Date.now() - started,
      status: "ok",
      errorCode: null
    });
    return { tools: tools.map((item) => item.tool) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const started = Date.now();
    const name = request.params.name;
    try {
      const { result, serverId } = await aggregator.callTool(
        namespaceId,
        name,
        request.params.arguments as Record<string, unknown> | undefined
      );
      recordRequest(core, {
        endpointId: endpoint.id,
        serverId,
        method: "tools/call",
        tool: name,
        durationMs: Date.now() - started,
        status: result.isError ? "error" : "ok",
        errorCode: result.isError ? "tool_error" : null
      });
      return result;
    } catch (error) {
      const code = error instanceof UpstreamError ? error.code : "upstream_error";
      recordRequest(core, {
        endpointId: endpoint.id,
        serverId: error instanceof UpstreamError ? error.serverId || null : null,
        method: "tools/call",
        tool: name,
        durationMs: Date.now() - started,
        status: "error",
        errorCode: code
      });
      if (error instanceof UpstreamError && error.code === "unknown_tool") {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await aggregator.listResources(namespaceId)
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: await aggregator.listResourceTemplates(namespaceId)
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: await aggregator.listPrompts(namespaceId)
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { result } = await aggregator.getPrompt(
      namespaceId,
      request.params.name,
      request.params.arguments as Record<string, string> | undefined
    );
    return result;
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { result } = await aggregator.readResource(namespaceId, request.params.uri);
    return result;
  });

  return server;
}

export function createMcpRoute(options: McpRouteOptions): Hono {
  const { core } = options;
  const app = new Hono();

  app.all("/:slug", async (c) => {
    const request = c.req.raw;
    const slug = c.req.param("slug");

    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "only POST is supported, this gateway is stateless", { allow: "POST" });
    }

    const originError = checkOrigin(request, core.config.baseUrl);
    if (originError) return jsonRpcError(403, -32000, originError);

    const endpoint = endpointBySlug(core.db, slug);
    if (!endpoint || !endpoint.enabled) return jsonRpcError(404, -32001, "endpoint not found");

    const audience = `${core.config.baseUrl ?? new URL(request.url).origin}/mcp/${endpoint.slug}`;
    const auth = await authenticateEndpoint(core.db, endpoint, request, options.verifier, audience);
    if (!auth.ok) {
      return jsonRpcError(auth.status, -32001, auth.description, {
        "www-authenticate": challengeHeader(endpoint, core.config.baseUrl, auth.error, auth.description)
      });
    }

    const server = buildServer(core, endpoint);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } catch (error) {
      core.logger.error("mcp request failed", { endpoint: slug, error: String(error) });
      return jsonRpcError(500, -32603, "internal error");
    } finally {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    }
  });

  return app;
}
