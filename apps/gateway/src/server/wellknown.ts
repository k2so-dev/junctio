import { Hono } from "hono";
import type { Core } from "../core.ts";
import { endpoints as endpointsTable } from "../db/schema.ts";
import { endpointAllowsOauth, endpointBySlug } from "../auth/downstream/middleware.ts";
import type { RemoteJwtVerifier } from "../auth/downstream/jwt.ts";

export type WellKnownOptions = {
  core: Core;
  verifier: RemoteJwtVerifier | null;
};

function baseOf(core: Core, request: Request): string {
  return core.config.baseUrl ?? new URL(request.url).origin;
}

export function createWellKnownRoute(options: WellKnownOptions): Hono {
  const { core } = options;
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
    const issuer = core.config.oauthIssuer;
    return Response.json({
      resource: `${base}/mcp/${endpoint.slug}`,
      authorization_servers: issuer ? [issuer] : [],
      bearer_methods_supported: ["header"],
      resource_name: `junctio ${endpoint.slug}`,
      resource_documentation: "https://github.com/junctio/junctio"
    });
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
    if (!options.verifier || !core.config.oauthIssuer) return c.json({ error: "not_found" }, 404);
    try {
      const metadata = await options.verifier.metadataOnce();
      return c.json(metadata);
    } catch (error) {
      core.logger.warn("issuer metadata unavailable", { error: String(error) });
      return c.json({ error: "server_error" }, 502);
    }
  });

  app.get("/oauth-authorization-server", async (c) => {
    if (!core.config.oauthIssuer || !options.verifier) return c.json({ error: "not_found" }, 404);
    const rows = core.db.select().from(endpointsTable).all();
    if (!rows.some((endpoint) => endpoint.enabled && endpointAllowsOauth(endpoint))) {
      return c.json({ error: "not_found" }, 404);
    }
    try {
      return c.json(await options.verifier.metadataOnce());
    } catch {
      return c.json({ error: "server_error" }, 502);
    }
  });

  return app;
}
