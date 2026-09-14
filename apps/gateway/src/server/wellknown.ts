import { Hono } from "hono";
import type { Core } from "../core.ts";
import { endpoints as endpointsTable } from "../db/schema.ts";
import { endpointAllowsOauth, endpointBySlug } from "../auth/downstream/middleware.ts";
import type { RemoteJwtVerifier } from "../auth/downstream/jwt.ts";
import { authorizationServerMetadata } from "../auth/downstream/as/index.ts";

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

  const protectedResource = async (slug: string, request: Request): Promise<Response> => {
    const endpoint = endpointBySlug(core.db, slug);
    if (!endpoint || !endpoint.enabled || !endpointAllowsOauth(endpoint)) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    const base = baseOf(core, request);
    return Response.json({
      resource: `${base}/mcp/${endpoint.slug}`,
      authorization_servers: [core.config.oauthIssuer ?? base],
      bearer_methods_supported: ["header"],
      resource_name: `junctio ${endpoint.slug}`,
      resource_documentation: "https://github.com/junctio/junctio"
    });
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
    const endpoint = endpointBySlug(core.db, c.req.param("slug"));
    if (!endpoint || !endpoint.enabled || !endpointAllowsOauth(endpoint)) return c.json({ error: "not_found" }, 404);
    return authorizationServer(c.req.raw);
  });

  app.get("/oauth-authorization-server", async (c) => {
    const rows = core.db.select().from(endpointsTable).all();
    if (!rows.some((endpoint) => endpoint.enabled && endpointAllowsOauth(endpoint))) {
      return c.json({ error: "not_found" }, 404);
    }
    return authorizationServer(c.req.raw);
  });

  return app;
}
