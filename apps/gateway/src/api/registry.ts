import { Hono } from "hono";
import type { Context } from "hono";
import {
  RegistryDetailQuery,
  RegistryQuery,
  type RegistryDetailDto,
  type RegistryListDto,
  type RegistryServerDto
} from "@junctio/schema";
import type { Core } from "../core.ts";
import { servers } from "../db/schema.ts";
import type { ServerRow } from "../db/schema.ts";
import { RegistryError } from "../registry/client.ts";
import { installOptions, serverName, summarize, uniqueName } from "../registry/install.ts";
import { registryEntries, type RegistryEntry } from "../registry/types.ts";
import { badRequest, notFound } from "./util.ts";

function isInstalled(entry: RegistryEntry, rows: ServerRow[]): boolean {
  const urls = new Set<string>();
  for (const remote of entry.server.remotes ?? []) if (remote.url) urls.add(remote.url);
  const identifiers = new Set<string>();
  for (const item of entry.server.packages ?? []) if (item.identifier) identifiers.add(item.identifier);

  return rows.some((row) => {
    if (row.url && urls.has(row.url)) return true;
    return row.args.some((arg) => {
      const bare = arg.includes("@") ? arg.slice(0, arg.lastIndexOf("@")) : arg;
      return identifiers.has(arg) || (bare !== "" && identifiers.has(bare));
    });
  });
}

function unavailable(c: Context, error: RegistryError) {
  return c.json({ error: "registry_unavailable", message: error.message }, 502);
}

export function createRegistryApi(core: Core): Hono {
  const app = new Hono();

  app.get("/servers", async (c) => {
    const parsed = RegistryQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return badRequest(c, parsed.error);
    const query = parsed.data;

    try {
      const result = await core.registryClient.list({
        limit: query.limit,
        refresh: query.refresh,
        ...(query.search ? { search: query.search } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {})
      });
      const rows = core.db.select().from(servers).all();
      const items: RegistryServerDto[] = registryEntries(result.body).map((entry) =>
        summarize(entry, isInstalled(entry, rows))
      );
      const payload: RegistryListDto = {
        items,
        nextCursor: result.body.metadata?.nextCursor ?? null,
        fetchedAt: result.fetchedAt,
        stale: result.stale,
        error: result.error
      };
      return c.json(payload);
    } catch (error) {
      if (error instanceof RegistryError) return unavailable(c, error);
      throw error;
    }
  });

  app.get("/server", async (c) => {
    const parsed = RegistryDetailQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return badRequest(c, parsed.error);

    try {
      const result = await core.registryClient.get(parsed.data.name, parsed.data.refresh);
      const rows = core.db.select().from(servers).all();
      const taken = new Set(rows.map((row) => row.name));
      const name = uniqueName(serverName(result.body.server.name), taken);
      const payload: RegistryDetailDto = {
        server: summarize(result.body, isInstalled(result.body, rows)),
        options: installOptions(result.body, name),
        fetchedAt: result.fetchedAt,
        stale: result.stale,
        error: result.error
      };
      return c.json(payload);
    } catch (error) {
      if (error instanceof RegistryError) {
        if (error.status === 404) return notFound(c, "registry server");
        return unavailable(c, error);
      }
      throw error;
    }
  });

  return app;
}
