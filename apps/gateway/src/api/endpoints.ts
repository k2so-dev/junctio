import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { EndpointInput, EndpointPatch } from "@junctio/schema";
import type { Core } from "../core.ts";
import { endpoints, namespaces } from "../db/schema.ts";
import type { EndpointRow } from "../db/schema.ts";
import { randomId } from "../crypto.ts";
import { toEndpointDto } from "./dto.ts";
import { badRequest, conflict, notFound, readJson } from "./util.ts";

function findEndpoint(core: Core, id: string): EndpointRow | null {
  return core.db.select().from(endpoints).where(eq(endpoints.id, id)).get() ?? null;
}

export function createEndpointsApi(core: Core): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const rows = core.db.select().from(endpoints).all();
    return c.json(rows.map((row) => toEndpointDto(core, row)));
  });

  app.post("/", async (c) => {
    const parsed = EndpointInput.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const input = parsed.data;
    if (core.db.select().from(endpoints).where(eq(endpoints.slug, input.slug)).get()) {
      return conflict(c, `endpoint "${input.slug}" already exists`);
    }
    if (!core.db.select().from(namespaces).where(eq(namespaces.id, input.namespaceId)).get()) {
      return notFound(c, "namespace");
    }
    if ((input.authMode === "oauth" || input.authMode === "any") && !core.config.oauthIssuer) {
      return badRequest(c, "JUNCTIO_OAUTH_ISSUER must be set to use oauth on an endpoint");
    }
    const id = randomId();
    core.db
      .insert(endpoints)
      .values({
        id,
        slug: input.slug,
        namespaceId: input.namespaceId,
        authMode: input.authMode,
        protocolMin: input.protocolMin,
        rateLimit: input.rateLimit,
        enabled: input.enabled,
        createdAt: Date.now()
      })
      .run();
    const row = findEndpoint(core, id);
    if (!row) return notFound(c, "endpoint");
    return c.json(toEndpointDto(core, row), 201);
  });

  app.get("/:id", (c) => {
    const row = findEndpoint(core, c.req.param("id"));
    if (!row) return notFound(c, "endpoint");
    return c.json(toEndpointDto(core, row));
  });

  app.patch("/:id", async (c) => {
    const row = findEndpoint(core, c.req.param("id"));
    if (!row) return notFound(c, "endpoint");
    const parsed = EndpointPatch.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const patch = parsed.data;
    if (patch.slug && patch.slug !== row.slug) {
      if (core.db.select().from(endpoints).where(eq(endpoints.slug, patch.slug)).get()) {
        return conflict(c, `endpoint "${patch.slug}" already exists`);
      }
    }
    if ((patch.authMode === "oauth" || patch.authMode === "any") && !core.config.oauthIssuer) {
      return badRequest(c, "JUNCTIO_OAUTH_ISSUER must be set to use oauth on an endpoint");
    }
    if (
      patch.namespaceId !== undefined &&
      !core.db.select().from(namespaces).where(eq(namespaces.id, patch.namespaceId)).get()
    ) {
      return notFound(c, "namespace");
    }
    core.db
      .update(endpoints)
      .set({
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.namespaceId !== undefined ? { namespaceId: patch.namespaceId } : {}),
        ...(patch.authMode !== undefined ? { authMode: patch.authMode } : {}),
        ...(patch.protocolMin !== undefined ? { protocolMin: patch.protocolMin } : {}),
        ...(patch.rateLimit !== undefined ? { rateLimit: patch.rateLimit } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {})
      })
      .where(eq(endpoints.id, row.id))
      .run();
    const updated = findEndpoint(core, row.id);
    if (!updated) return notFound(c, "endpoint");
    return c.json(toEndpointDto(core, updated));
  });

  app.delete("/:id", (c) => {
    const row = findEndpoint(core, c.req.param("id"));
    if (!row) return notFound(c, "endpoint");
    core.db.delete(endpoints).where(eq(endpoints.id, row.id)).run();
    return c.body(null, 204);
  });

  return app;
}
