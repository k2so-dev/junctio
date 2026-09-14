import { Hono } from "hono";
import { and, count, desc, eq, isNotNull, max } from "drizzle-orm";
import { EndpointInput, EndpointPatch, type EndpointProtocolUsageDto } from "@junctio/schema";
import type { Core } from "../core.ts";
import { endpoints, namespaces, requestLog } from "../db/schema.ts";
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

  app.get("/:id/protocols", (c) => {
    const row = findEndpoint(core, c.req.param("id"));
    if (!row) return notFound(c, "endpoint");
    const rows = core.db
      .select({
        protocol: requestLog.protocol,
        count: count(),
        lastSeenAt: max(requestLog.ts)
      })
      .from(requestLog)
      .where(and(eq(requestLog.endpointId, row.id), isNotNull(requestLog.protocol)))
      .groupBy(requestLog.protocol)
      .orderBy(desc(max(requestLog.ts)))
      .all();
    const items: EndpointProtocolUsageDto[] = rows.map((entry) => ({
      protocol: entry.protocol ?? "",
      count: entry.count,
      lastSeenAt: entry.lastSeenAt ?? 0
    }));
    return c.json(items);
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
