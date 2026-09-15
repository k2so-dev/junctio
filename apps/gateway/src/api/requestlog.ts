import { Hono } from "hono";
import { and, desc, eq, lt } from "drizzle-orm";
import { RequestLogQuery, type RequestLogDto } from "@junctio/schema";
import type { Core } from "../core.ts";
import { endpoints, requestLog, servers } from "../db/schema.ts";
import { badRequest } from "./util.ts";

export function createRequestLogApi(core: Core): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const url = new URL(c.req.url);
    const parsed = RequestLogQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return badRequest(c, parsed.error);
    const query = parsed.data;
    const filters = [
      query.endpointId ? eq(requestLog.endpointId, query.endpointId) : undefined,
      query.serverId ? eq(requestLog.serverId, query.serverId) : undefined,
      query.status ? eq(requestLog.status, query.status) : undefined,
      query.before ? lt(requestLog.ts, query.before) : undefined
    ].filter((value) => value !== undefined);

    const rows = core.db
      .select()
      .from(requestLog)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(requestLog.ts))
      .limit(query.limit)
      .all();

    const endpointNames = new Map(
      core.db
        .select()
        .from(endpoints)
        .all()
        .map((row) => [row.id, row.slug])
    );
    const serverNames = new Map(
      core.db
        .select()
        .from(servers)
        .all()
        .map((row) => [row.id, row.name])
    );

    const items: RequestLogDto[] = rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      endpointId: row.endpointId,
      endpointSlug: row.endpointId ? (endpointNames.get(row.endpointId) ?? null) : null,
      serverId: row.serverId,
      serverName: row.serverId ? (serverNames.get(row.serverId) ?? null) : null,
      method: row.method,
      tool: row.tool,
      protocol: row.protocol,
      durationMs: row.durationMs,
      status: row.status,
      errorCode: row.errorCode
    }));
    return c.json(items);
  });

  return app;
}
