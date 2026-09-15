import { Hono } from "hono";
import {
  createMcpHandler,
  isLegacyRequest,
  ProtocolError,
  ProtocolErrorCode,
  Server,
  WebStandardStreamableHTTPServerTransport
} from "@modelcontextprotocol/server";
import { latestProtocolVersion, protocolVersions } from "@junctio/schema";
import type { Core } from "../core.ts";
import { VERSION } from "../config.ts";
import type { EndpointRow } from "../db/schema.ts";
import { authenticateEndpoint, challengeHeader, endpointBySlug, type JwtVerifier } from "../auth/downstream/middleware.ts";
import { recordRequest } from "./requestlog.ts";
import { checkOrigin } from "./origin.ts";
import { EndpointLimiter, clientAddress } from "./ratelimit.ts";
import type { AppEnv } from "./env.ts";
import { UpstreamError } from "../upstream/types.ts";

export type McpRouteOptions = {
  core: Core;
  verifier: JwtVerifier | null;
};

const LEGACY_PROTOCOL = "2025-03-26";
const MODERN_PROTOCOL = latestProtocolVersion;

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

function requestedMethod(body: unknown): string | null {
  const message = (Array.isArray(body) ? body[0] : body) as { method?: unknown } | undefined;
  return typeof message?.method === "string" ? message.method : null;
}

function requestedProtocol(request: Request, body: unknown): string | null {
  const header = request.headers.get("mcp-protocol-version");
  if (header) return header.trim();
  const message = (Array.isArray(body) ? body[0] : body) as
    | { method?: unknown; params?: { protocolVersion?: unknown } }
    | undefined;
  if (message?.method !== "initialize") return null;
  const version = message.params?.protocolVersion;
  return typeof version === "string" ? version : LEGACY_PROTOCOL;
}

async function serveLegacy(
  core: Core,
  endpoint: EndpointRow,
  request: Request,
  protocol: string | null
): Promise<Response> {
  const server = buildServer(core, endpoint, protocol);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
}

export function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
  data?: unknown
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message, ...(data === undefined ? {} : { data }) }, id: null }),
    {
      status,
      headers: { "content-type": "application/json", ...headers }
    }
  );
}

function buildServer(core: Core, endpoint: EndpointRow, protocol: string | null): Server {
  const server = new Server(
    { name: "junctio", version: VERSION },
    { capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} } }
  );
  const { aggregator } = core;
  const namespaceId = endpoint.namespaceId;

  server.setRequestHandler("tools/list", async () => {
    const started = Date.now();
    const tools = await aggregator.listTools(namespaceId);
    recordRequest(core, {
      endpointId: endpoint.id,
      serverId: null,
      method: "tools/list",
      tool: null,
      protocol,
      durationMs: Date.now() - started,
      status: "ok",
      errorCode: null
    });
    return { tools: tools.map((item) => item.tool) };
  });

  server.setRequestHandler("tools/call", async (request) => {
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
        protocol,
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
        protocol,
        durationMs: Date.now() - started,
        status: "error",
        errorCode: code
      });
      if (error instanceof UpstreamError && error.code === "unknown_tool") {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  });

  server.setRequestHandler("resources/list", async () => ({
    resources: await aggregator.listResources(namespaceId)
  }));

  server.setRequestHandler("resources/templates/list", async () => ({
    resourceTemplates: await aggregator.listResourceTemplates(namespaceId)
  }));

  server.setRequestHandler("prompts/list", async () => ({
    prompts: await aggregator.listPrompts(namespaceId)
  }));

  server.setRequestHandler("prompts/get", async (request) => {
    const { result } = await aggregator.getPrompt(
      namespaceId,
      request.params.name,
      request.params.arguments as Record<string, string> | undefined
    );
    return result;
  });

  server.setRequestHandler("resources/read", async (request) => {
    const { result } = await aggregator.readResource(namespaceId, request.params.uri);
    return result;
  });

  return server;
}

export function createMcpRoute(options: McpRouteOptions): Hono<AppEnv> {
  const { core } = options;
  const app = new Hono<AppEnv>();
  const limiter = new EndpointLimiter();

  const serveModern = async (
    endpoint: EndpointRow,
    request: Request,
    body: unknown,
    protocol: string | null
  ): Promise<Response> => {
    const handler = createMcpHandler(() => buildServer(core, endpoint, protocol), {
      legacy: "reject",
      onerror: (error) => core.logger.error("mcp request failed", { endpoint: endpoint.slug, error: String(error) })
    });
    return await handler.fetch(request, body === undefined ? undefined : { parsedBody: body });
  };

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

    const quotaKey = auth.key
      ? `key:${auth.key.id}`
      : auth.claims
        ? `sub:${auth.claims.subject}`
        : `addr:${clientAddress(request, { ip: c.env.ip, trustProxy: core.config.trustProxy })}`;
    const quota = limiter.check(endpoint.id, endpoint.rateLimit?.perMinute ?? 0, quotaKey);
    if (!quota.allowed) {
      return jsonRpcError(429, -32000, "rate limit exceeded for this endpoint", {
        "retry-after": String(quota.retryAfterSec)
      });
    }

    const body = await readBody(request);
    const protocol = requestedProtocol(request, body);
    if (protocol !== null && protocol < endpoint.protocolMin) {
      const supported = protocolVersions.filter((version) => version >= endpoint.protocolMin);
      recordRequest(core, {
        endpointId: endpoint.id,
        serverId: null,
        method: requestedMethod(body) ?? "unknown",
        tool: null,
        protocol,
        durationMs: 0,
        status: "error",
        errorCode: "unsupported_protocol"
      });
      return jsonRpcError(
        400,
        ProtocolErrorCode.UnsupportedProtocolVersion,
        `endpoint requires protocol version ${endpoint.protocolMin} or newer, client offered ${protocol}`,
        {},
        { supported, requested: protocol }
      );
    }

    try {
      if (endpoint.protocolMin < MODERN_PROTOCOL && (await isLegacyRequest(request, body))) {
        return await serveLegacy(core, endpoint, request, protocol);
      }
      return await serveModern(endpoint, request, body, protocol);
    } catch (error) {
      core.logger.error("mcp request failed", { endpoint: slug, error: String(error) });
      return jsonRpcError(500, -32603, "internal error");
    }
  });

  return app;
}
