import { Hono } from "hono";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  LoginInput,
  RequestLogQuery,
  SettingsPatch,
  SetupInput,
  type RequestLogDto,
  type SessionDto,
  type SettingsDto
} from "@junctio/schema";
import type { Core } from "../core.ts";
import { endpoints, requestLog, servers } from "../db/schema.ts";
import { getSettings, setSetting } from "../db/settings.ts";
import {
  SESSION_COOKIE,
  clearCookie,
  createSession,
  destroySession,
  isAdmin,
  needsSetup,
  readCookie,
  sessionCookie,
  setAdminPassword,
  verifyAdminPassword
} from "../auth/downstream/admin.ts";
import { RateLimiter, clientAddress } from "../server/ratelimit.ts";
import { checkOrigin } from "../server/origin.ts";
import { createServersApi } from "./servers.ts";
import { createNamespacesApi } from "./namespaces.ts";
import { createEndpointsApi } from "./endpoints.ts";
import { createApiKeysApi } from "./apikeys.ts";
import { badRequest, readJson } from "./util.ts";

const OPEN_PATHS = new Set(["/v1/session", "/v1/session/login", "/v1/session/setup"]);

export function createApi(core: Core): Hono {
  const app = new Hono();
  const loginLimiter = new RateLimiter(10, 60_000);
  const secureCookies = (core.config.baseUrl ?? "").startsWith("https://");

  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const originError = checkOrigin(c.req.raw, core.config.baseUrl);
      if (originError) return c.json({ error: "forbidden", message: originError }, 403);
    }
    const path = new URL(c.req.url).pathname.replace(/^\/api/, "");
    if (OPEN_PATHS.has(path)) return next();
    if (!isAdmin(core.db, c.req.raw, core.config.adminToken)) {
      return c.json({ error: "unauthorized", message: "admin authentication required" }, 401);
    }
    return next();
  });

  app.get("/v1/session", (c) => {
    const session: SessionDto = {
      authenticated: isAdmin(core.db, c.req.raw, core.config.adminToken),
      needsSetup: needsSetup(core.db)
    };
    return c.json(session);
  });

  app.post("/v1/session/setup", async (c) => {
    if (!needsSetup(core.db)) return badRequest(c, "admin password is already set");
    const parsed = SetupInput.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    await setAdminPassword(core.db, parsed.data.password);
    const session = createSession(core.db);
    c.header("set-cookie", sessionCookie(session.id, secureCookies));
    return c.json({ ok: true });
  });

  app.post("/v1/session/login", async (c) => {
    const address = clientAddress(c.req.raw);
    const limit = loginLimiter.check(address);
    if (!limit.allowed) {
      c.header("retry-after", String(limit.retryAfterSec));
      return c.json({ error: "rate_limited", message: "too many login attempts" }, 429);
    }
    const parsed = LoginInput.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    if (!(await verifyAdminPassword(core.db, parsed.data.password))) {
      return c.json({ error: "unauthorized", message: "invalid password" }, 401);
    }
    loginLimiter.reset(address);
    const session = createSession(core.db);
    c.header("set-cookie", sessionCookie(session.id, secureCookies));
    return c.json({ ok: true });
  });

  app.post("/v1/session/logout", (c) => {
    const cookie = readCookie(c.req.raw, SESSION_COOKIE);
    if (cookie) destroySession(core.db, cookie);
    c.header("set-cookie", clearCookie(secureCookies));
    return c.json({ ok: true });
  });

  app.route("/v1/servers", createServersApi(core));
  app.route("/v1/namespaces", createNamespacesApi(core));
  app.route("/v1/endpoints", createEndpointsApi(core));
  app.route("/v1/api-keys", createApiKeysApi(core));

  app.get("/v1/settings", (c) => {
    const stored = getSettings(core.db);
    const settings: SettingsDto = {
      baseUrl: core.config.baseUrl ?? `http://localhost:${core.config.port}`,
      toolSeparator: stored.tool_separator,
      runtimePath: stored.runtime_path,
      apiKeyQueryParam: stored.api_key_query_param === "true",
      requestLogRetentionDays: Number(stored.request_log_retention_days),
      oauthIssuer: core.config.oauthIssuer,
      version: core.config.version
    };
    return c.json(settings);
  });

  app.patch("/v1/settings", async (c) => {
    const parsed = SettingsPatch.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const patch = parsed.data;
    if (patch.toolSeparator !== undefined) setSetting(core.db, "tool_separator", patch.toolSeparator);
    if (patch.runtimePath !== undefined) setSetting(core.db, "runtime_path", patch.runtimePath);
    if (patch.apiKeyQueryParam !== undefined) {
      setSetting(core.db, "api_key_query_param", patch.apiKeyQueryParam ? "true" : "false");
    }
    if (patch.requestLogRetentionDays !== undefined) {
      setSetting(core.db, "request_log_retention_days", String(patch.requestLogRetentionDays));
    }
    core.registry.invalidate();
    return c.json({ ok: true });
  });

  app.get("/v1/request-log", (c) => {
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

    const endpointNames = new Map(core.db.select().from(endpoints).all().map((row) => [row.id, row.slug]));
    const serverNames = new Map(core.db.select().from(servers).all().map((row) => [row.id, row.name]));

    const items: RequestLogDto[] = rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      endpointId: row.endpointId,
      endpointSlug: row.endpointId ? (endpointNames.get(row.endpointId) ?? null) : null,
      serverId: row.serverId,
      serverName: row.serverId ? (serverNames.get(row.serverId) ?? null) : null,
      method: row.method,
      tool: row.tool,
      durationMs: row.durationMs,
      status: row.status,
      errorCode: row.errorCode
    }));
    return c.json(items);
  });

  return app;
}
