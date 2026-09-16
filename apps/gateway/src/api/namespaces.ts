import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  NamespaceInput,
  NamespacePatch,
  NamespaceServerInput,
  ToolOverrideInput,
  type NamespaceToolDto
} from "@junctio/schema";
import type { Core } from "../core.ts";
import { namespaceServers, namespaces, servers, toolOverrides } from "../db/schema.ts";
import type { NamespaceRow } from "../db/schema.ts";
import { randomId } from "../crypto.ts";
import { toNamespaceDto } from "./dto.ts";
import { badRequest, conflict, notFound, readJson } from "./util.ts";
import { CollisionError, exposedToolName } from "../aggregate/naming.ts";

function findNamespace(core: Core, id: string): NamespaceRow | null {
  return core.db.select().from(namespaces).where(eq(namespaces.id, id)).get() ?? null;
}

export function createNamespacesApi(core: Core): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const rows = core.db.select().from(namespaces).all();
    return c.json(rows.map((row) => toNamespaceDto(core, row)));
  });

  app.post("/", async (c) => {
    const parsed = NamespaceInput.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    if (core.db.select().from(namespaces).where(eq(namespaces.name, parsed.data.name)).get()) {
      return conflict(c, `namespace "${parsed.data.name}" already exists`);
    }
    const id = randomId();
    core.db
      .insert(namespaces)
      .values({ id, name: parsed.data.name, description: parsed.data.description, createdAt: Date.now() })
      .run();
    const row = findNamespace(core, id);
    if (!row) return notFound(c, "namespace");
    return c.json(toNamespaceDto(core, row), 201);
  });

  app.get("/:id", (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    return c.json(toNamespaceDto(core, row));
  });

  app.patch("/:id", async (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    const parsed = NamespacePatch.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    if (parsed.data.name && parsed.data.name !== row.name) {
      if (core.db.select().from(namespaces).where(eq(namespaces.name, parsed.data.name)).get()) {
        return conflict(c, `namespace "${parsed.data.name}" already exists`);
      }
    }
    core.db
      .update(namespaces)
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {})
      })
      .where(eq(namespaces.id, row.id))
      .run();
    const updated = findNamespace(core, row.id);
    if (!updated) return notFound(c, "namespace");
    return c.json(toNamespaceDto(core, updated));
  });

  app.delete("/:id", (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    core.db.delete(namespaces).where(eq(namespaces.id, row.id)).run();
    return c.body(null, 204);
  });

  app.post("/:id/servers", async (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    const parsed = NamespaceServerInput.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const server = core.db.select().from(servers).where(eq(servers.id, parsed.data.serverId)).get();
    if (!server) return notFound(c, "server");

    const description = parsed.data.description === undefined ? undefined : parsed.data.description?.trim() || null;

    try {
      core.db.transaction((tx) => {
        tx.insert(namespaceServers)
          .values({
            namespaceId: row.id,
            serverId: parsed.data.serverId,
            prefix: parsed.data.prefix,
            description: description ?? null,
            enabled: parsed.data.enabled
          })
          .onConflictDoUpdate({
            target: [namespaceServers.namespaceId, namespaceServers.serverId],
            set: {
              prefix: parsed.data.prefix,
              enabled: parsed.data.enabled,
              ...(description !== undefined ? { description } : {})
            }
          })
          .run();
        core.aggregator.checkPrefixes(row.id);
      });
    } catch (error) {
      if (error instanceof CollisionError) return conflict(c, error.message);
      throw error;
    }

    const updated = findNamespace(core, row.id);
    if (!updated) return notFound(c, "namespace");
    return c.json(toNamespaceDto(core, updated));
  });

  app.delete("/:id/servers/:serverId", (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    core.db
      .delete(namespaceServers)
      .where(and(eq(namespaceServers.namespaceId, row.id), eq(namespaceServers.serverId, c.req.param("serverId"))))
      .run();
    return c.body(null, 204);
  });

  app.get("/:id/instructions", async (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    const instructions = await core.aggregator.instructions(row.id);
    return c.json({ instructions: instructions ?? null });
  });

  app.get("/:id/tools", async (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    const overrides = core.aggregator.overrides(row.id);
    const separator = core.aggregator.separator;
    const out: NamespaceToolDto[] = [];
    for (const member of core.aggregator.members(row.id, false)) {
      const catalog = await core.pool.safeCatalog(member.serverId);
      for (const tool of catalog.tools) {
        const override = overrides.get(`${member.serverId} ${tool.name}`);
        out.push({
          serverId: member.serverId,
          serverName: member.serverName,
          toolName: tool.name,
          exposedName: exposedToolName(member.prefix, tool.name, separator),
          enabled: override?.enabled ?? true,
          displayName: override?.displayName ?? null,
          description: override?.description ?? null,
          originalDescription: tool.description ?? null,
          annotations: (override?.annotations as Record<string, unknown> | null) ?? null,
          originalAnnotations: (tool.annotations as Record<string, unknown> | undefined) ?? null
        });
      }
    }
    return c.json(out);
  });

  app.put("/:id/tools", async (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    const parsed = ToolOverrideInput.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const input = parsed.data;
    const member = core.db
      .select()
      .from(namespaceServers)
      .where(and(eq(namespaceServers.namespaceId, row.id), eq(namespaceServers.serverId, input.serverId)))
      .get();
    if (!member) return badRequest(c, "server is not a member of this namespace");
    core.db
      .insert(toolOverrides)
      .values({
        namespaceId: row.id,
        serverId: input.serverId,
        toolName: input.toolName,
        enabled: input.enabled,
        displayName: input.displayName,
        description: input.description,
        annotations: input.annotations
      })
      .onConflictDoUpdate({
        target: [toolOverrides.namespaceId, toolOverrides.serverId, toolOverrides.toolName],
        set: {
          enabled: input.enabled,
          displayName: input.displayName,
          description: input.description,
          annotations: input.annotations
        }
      })
      .run();
    return c.json({ ok: true });
  });

  app.delete("/:id/tools/:serverId/:toolName", (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    core.db
      .delete(toolOverrides)
      .where(
        and(
          eq(toolOverrides.namespaceId, row.id),
          eq(toolOverrides.serverId, c.req.param("serverId")),
          eq(toolOverrides.toolName, decodeURIComponent(c.req.param("toolName")))
        )
      )
      .run();
    return c.body(null, 204);
  });

  app.post("/:id/validate", (c) => {
    const row = findNamespace(core, c.req.param("id"));
    if (!row) return notFound(c, "namespace");
    try {
      core.aggregator.validate(row.id);
      return c.json({ ok: true, conflicts: [] });
    } catch (error) {
      if (error instanceof CollisionError) return c.json({ ok: false, conflicts: error.conflicts }, 409);
      throw error;
    }
  });

  return app;
}
