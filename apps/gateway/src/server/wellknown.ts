import { Hono } from "hono";
import type { Core } from "../core.ts";
import { endpoints as endpointsTable } from "../db/schema.ts";
import { ADMIN_MCP_SLUG, endpointAllowsOauth, endpointBySlug } from "../auth/downstream/middleware.ts";
import type { RemoteJwtVerifier } from "../auth/downstream/jwt.ts";
import { authorizationServerMetadata } from "../auth/downstream/as/index.ts";
import { adminMcpEnabled } from "../api/settings.ts";

export type WellKnownOptions = {
  core: Core;
  remote: RemoteJwtVerifier | null;
};

function baseOf(core: Core, request: Request): string {
  return core.config.baseUrl ?? new URL(request.url).origin;
}

export function createWellKnownRoute(options: WellKnownOptions): Hono {
  const { core, remote } = options;
  const app = new Hono();

  const adminOauth = (): boolean => remote === null && adminMcpEnabled(core);

  const missing = (): Response =>
    new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" }
    });

  const resourceMetadata = (base: string, slug: string, name: string): Response =>
    Response.json({
      resource: `${base}/mcp/${slug}`,
      authorization_servers: [core.config.oauthIssuer ?? base],
      bearer_methods_supported: ["header"],
      resource_name: name,
      resource_documentation: "https://github.com/k2so-dev/junctio"
    });

  const protectedResource = async (slug: string, request: Request): Promise<Response> => {
    const base = baseOf(core, request);
    if (slug === ADMIN_MCP_SLUG) {
      if (!adminOauth()) return missing();
      return resourceMetadata(base, ADMIN_MCP_SLUG, "Junctio management");
    }
    const endpoint = endpointBySlug(core.db, slug);
    if (!endpoint?.enabled || !endpointAllowsOauth(endpoint)) return missing();
    return resourceMetadata(base, endpoint.slug, `Junctio ${endpoint.slug}`);
  };

  const authorizationServer = async (request: Request): Promise<Response> => {
    if (!remote) return Response.json(authorizationServerMetadata(baseOf(core, request)));
    try {
      return Response.json(await remote.metadataOnce());
    } catch (error) {
      core.logger.warn("issuer metadata unavailable", { error: String(error) });
      return Response.json({ error: "server_error" }, { status: 502 });
    }
  };

  app.get("/oauth-protected-resource/mcp/:slug", (c) => protectedResource(c.req.param("slug"), c.req.raw));
  app.get("/oauth-protected-resource", async (c) => {
    const slug = new URL(c.req.url).searchParams.get("endpoint");
    if (!slug) return c.json({ error: "not_found" }, 404);
    return protectedResource(slug, c.req.raw);
  });

  app.get("/oauth-authorization-server/mcp/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (slug === ADMIN_MCP_SLUG) {
      if (!adminOauth()) return c.json({ error: "not_found" }, 404);
      return authorizationServer(c.req.raw);
    }
    const endpoint = endpointBySlug(core.db, slug);
    if (!endpoint?.enabled || !endpointAllowsOauth(endpoint)) return c.json({ error: "not_found" }, 404);
    return authorizationServer(c.req.raw);
  });

  app.get("/oauth-authorization-server", async (c) => {
    const rows = core.db.select().from(endpointsTable).all();
    const anyEndpoint = rows.some((endpoint) => endpoint.enabled && endpointAllowsOauth(endpoint));
    if (!anyEndpoint && !adminOauth()) return c.json({ error: "not_found" }, 404);
    return authorizationServer(c.req.raw);
  });

  return app;
}
