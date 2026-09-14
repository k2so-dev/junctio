import { Hono } from "hono";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Core } from "../core.ts";
import { buildAdminServer } from "../admin/server.ts";
import { adminMcpEnabled } from "../api/settings.ts";
import { ADMIN_MCP_SLUG, adminChallengeHeader, authenticateAdmin } from "../auth/downstream/middleware.ts";
import type { JwtVerifier } from "../auth/downstream/middleware.ts";
import { checkOrigin } from "./origin.ts";
import { jsonRpcError } from "./mcp.ts";

export type AdminMcpRouteOptions = {
  core: Core;
  verifier: JwtVerifier | null;
};

export function adminMcpPath(): string {
  return `/${ADMIN_MCP_SLUG}`;
}

export function createAdminMcpRoute(options: AdminMcpRouteOptions): Hono {
  const { core, verifier } = options;
  const app = new Hono();

  app.all(adminMcpPath(), async (c) => {
    const request = c.req.raw;

    if (!adminMcpEnabled(core)) return jsonRpcError(404, -32001, "management server is disabled");

    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "only POST is supported, this gateway is stateless", { allow: "POST" });
    }

    const originError = checkOrigin(request, core.config.baseUrl);
    if (originError) return jsonRpcError(403, -32000, originError);

    const base = core.config.baseUrl ?? new URL(request.url).origin;
    const auth = await authenticateAdmin(core.config.adminToken, request, verifier, `${base}/mcp/${ADMIN_MCP_SLUG}`);
    if (!auth.ok) {
      return jsonRpcError(auth.status, -32001, auth.description, {
        "www-authenticate": adminChallengeHeader(core.config.baseUrl, verifier !== null, auth.error, auth.description)
      });
    }

    const handler = createMcpHandler(() => buildAdminServer(core), {
      legacy: "stateless",
      onerror: (error) => core.logger.error("admin mcp request failed", { error: String(error) })
    });

    try {
      return await handler.fetch(request);
    } catch (error) {
      core.logger.error("admin mcp request failed", { error: String(error) });
      return jsonRpcError(500, -32603, "internal error");
    }
  });

  return app;
}
