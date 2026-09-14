import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { ServerInput, ServerPatch, type TestResultDto } from "@junctio/schema";
import type { Core } from "../core.ts";
import { servers } from "../db/schema.ts";
import type { ServerRow } from "../db/schema.ts";
import { randomId } from "../crypto.ts";
import { mergeHeaders, toServerDto } from "./dto.ts";
import { badRequest, conflict, notFound, readJson } from "./util.ts";
import { buildArgv, previewCommand } from "../upstream/command.ts";

const CONNECTION_FIELDS = [
  "transport",
  "runtime",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "authMode",
  "oauthScope",
  "enabled",
  "idleTimeoutSec"
] as const satisfies readonly (keyof ServerRow)[];

function findServer(core: Core, id: string): ServerRow | null {
  return core.db.select().from(servers).where(eq(servers.id, id)).get() ?? null;
}

function affectsConnection(
  before: ServerRow,
  after: ServerRow,
  headersBefore: Record<string, string>,
  headersAfter: Record<string, string> | undefined
): boolean {
  if (headersAfter !== undefined) {
    const next = Object.fromEntries(Object.entries(headersAfter).filter(([, value]) => value !== ""));
    if (JSON.stringify(headersBefore) !== JSON.stringify(next)) return true;
  }
  return CONNECTION_FIELDS.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

async function encodeHeaders(core: Core, headers: Record<string, string> | undefined): Promise<string | null | undefined> {
  if (headers === undefined) return undefined;
  const filtered = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ""));
  if (Object.keys(filtered).length === 0) return null;
  return core.cipher.encrypt(JSON.stringify(filtered));
}

export function createServersApi(core: Core): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = core.db.select().from(servers).all();
    return c.json(await Promise.all(rows.map((row) => toServerDto(core, row))));
  });

  app.post("/preview", async (c) => {
    const body = await readJson(c);
    const parsed = ServerInput.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error);
    return c.json({
      preview: previewCommand({
        runtime: parsed.data.runtime,
        command: parsed.data.command,
        args: parsed.data.args
      }),
      argv: buildArgv({ runtime: parsed.data.runtime, command: parsed.data.command, args: parsed.data.args })
    });
  });

  app.post("/", async (c) => {
    const parsed = ServerInput.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const input = parsed.data;
    if (core.db.select().from(servers).where(eq(servers.name, input.name)).get()) {
      return conflict(c, `server "${input.name}" already exists`);
    }
    const id = randomId();
    core.db
      .insert(servers)
      .values({
        id,
        name: input.name,
        transport: input.transport,
        runtime: input.runtime,
        command: input.command,
        args: input.args,
        env: input.env,
        cwd: input.cwd,
        url: input.url,
        headersEnc: (await encodeHeaders(core, input.headers)) ?? null,
        authMode: input.authMode,
        oauthScope: input.oauthScope,
        enabled: input.enabled,
        warm: input.warm,
        idleTimeoutSec: input.idleTimeoutSec,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      .run();
    const row = findServer(core, id);
    if (!row) return notFound(c, "server");
    return c.json(await toServerDto(core, row), 201);
  });

  app.get("/:id", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    return c.json(await toServerDto(core, row));
  });

  app.patch("/:id", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    const parsed = ServerPatch.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const patch = parsed.data;
    if (patch.name && patch.name !== row.name) {
      const clash = core.db.select().from(servers).where(eq(servers.name, patch.name)).get();
      if (clash) return conflict(c, `server "${patch.name}" already exists`);
    }
    const resolved = await core.registry.resolve(row.id);
    const headers = mergeHeaders(patch.headers, resolved?.headers ?? {});
    const headersEnc = await encodeHeaders(core, headers);

    core.db
      .update(servers)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.transport !== undefined ? { transport: patch.transport } : {}),
        ...(patch.runtime !== undefined ? { runtime: patch.runtime } : {}),
        ...(patch.command !== undefined ? { command: patch.command } : {}),
        ...(patch.args !== undefined ? { args: patch.args } : {}),
        ...(patch.env !== undefined ? { env: patch.env } : {}),
        ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(headersEnc !== undefined ? { headersEnc } : {}),
        ...(patch.authMode !== undefined ? { authMode: patch.authMode } : {}),
        ...(patch.oauthScope !== undefined ? { oauthScope: patch.oauthScope } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.warm !== undefined ? { warm: patch.warm } : {}),
        ...(patch.idleTimeoutSec !== undefined ? { idleTimeoutSec: patch.idleTimeoutSec } : {}),
        updatedAt: Date.now()
      })
      .where(eq(servers.id, row.id))
      .run();

    core.registry.invalidate(row.id);
    const updated = findServer(core, row.id);
    if (updated && affectsConnection(row, updated, resolved?.headers ?? {}, headers)) {
      await core.pool.invalidate(row.id, "server updated");
      await core.supervisor.stop(row.id);
      core.supervisor.reset(row.id);
    }
    if (!updated) return notFound(c, "server");
    return c.json(await toServerDto(core, updated));
  });

  app.delete("/:id", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    await core.pool.invalidate(row.id, "server deleted");
    await core.supervisor.stop(row.id);
    core.db.delete(servers).where(eq(servers.id, row.id)).run();
    core.registry.invalidate(row.id);
    core.logs.clear(row.id);
    return c.body(null, 204);
  });

  app.post("/:id/start", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    try {
      await core.pool.acquire(row.id);
    } catch (error) {
      return badRequest(c, error instanceof Error ? error.message : String(error));
    }
    return c.json(await toServerDto(core, row));
  });

  app.post("/:id/stop", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    await core.pool.invalidate(row.id, "stopped from the api");
    await core.supervisor.stop(row.id);
    return c.json(await toServerDto(core, row));
  });

  app.post("/:id/restart", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    await core.pool.invalidate(row.id, "restarted from the api");
    await core.supervisor.stop(row.id);
    core.supervisor.reset(row.id);
    try {
      await core.pool.acquire(row.id);
    } catch (error) {
      return badRequest(c, error instanceof Error ? error.message : String(error));
    }
    return c.json(await toServerDto(core, row));
  });

  app.post("/:id/reset", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    core.supervisor.reset(row.id);
    return c.json(await toServerDto(core, row));
  });

  app.post("/:id/test", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    const started = Date.now();
    try {
      const catalog = await core.pool.catalog(row.id, true);
      const client = await core.pool.acquire(row.id);
      const info = client.getServerVersion();
      const result: TestResultDto = {
        ok: true,
        durationMs: Date.now() - started,
        serverInfo: info ? { name: info.name, version: info.version } : null,
        protocolVersion: null,
        toolCount: catalog.tools.length,
        error: null
      };
      return c.json(result);
    } catch (error) {
      const result: TestResultDto = {
        ok: false,
        durationMs: Date.now() - started,
        serverInfo: null,
        protocolVersion: null,
        toolCount: null,
        error: error instanceof Error ? error.message : String(error)
      };
      return c.json(result);
    }
  });

  app.get("/:id/tools", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    const force = new URL(c.req.url).searchParams.get("refresh") === "1";
    try {
      const catalog = await core.pool.catalog(row.id, force);
      return c.json({
        tools: catalog.tools,
        resources: catalog.resources,
        prompts: catalog.prompts,
        fetchedAt: catalog.fetchedAt
      });
    } catch (error) {
      return badRequest(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/:id/logs", (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    const url = new URL(c.req.url);
    const tail = Math.min(1000, Math.max(1, Number(url.searchParams.get("tail") ?? "200")));
    if (url.searchParams.get("stream") !== "1") {
      return c.json(core.logs.tail(row.id, tail));
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            stop();
          }
        };
        const send = (payload: unknown) => write(`data: ${JSON.stringify(payload)}\n\n`);
        write(`retry: 3000\n\n`);
        for (const line of core.logs.tail(row.id, tail)) send(line);
        unsubscribe = core.logs.subscribe(row.id, send);
        heartbeat = setInterval(() => write(`: ping\n\n`), 20_000);
      },
      cancel() {
        stop();
      }
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      }
    });
  });

  app.post("/:id/oauth/start", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    if (row.authMode !== "oauth") return badRequest(c, "server is not configured for oauth");
    const flow = core.upstreamAuth.flow;
    if (!flow) return badRequest(c, "JUNCTIO_BASE_URL must be set before starting an oauth flow");
    try {
      const authorizationUrl = await flow.start(row.id);
      return c.json({ authorizationUrl });
    } catch (error) {
      return badRequest(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/:id/oauth/refresh", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    const refreshed = await core.upstreamAuth.refresher.refresh(row.id);
    return c.json({ refreshed, oauth: (await toServerDto(core, row)).oauth });
  });

  app.delete("/:id/oauth", async (c) => {
    const row = findServer(core, c.req.param("id"));
    if (!row) return notFound(c, "server");
    core.upstreamAuth.store.clear(row.id);
    await core.pool.invalidate(row.id, "oauth tokens cleared");
    return c.body(null, 204);
  });

  return app;
}
