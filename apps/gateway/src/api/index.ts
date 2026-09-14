import { Hono } from "hono";
import { LoginInput, SetupInput, type SessionDto } from "@junctio/schema";
import type { Core } from "../core.ts";
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
import { createRegistryApi } from "./registry.ts";
import { createOAuthApi } from "./oauth.ts";
import { createSettingsApi } from "./settings.ts";
import { createDockerApi } from "./docker.ts";
import { createRequestLogApi } from "./requestlog.ts";
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
  app.route("/v1/oauth", createOAuthApi(core));
  app.route("/v1/registry", createRegistryApi(core));
  app.route("/v1/settings", createSettingsApi(core));
  app.route("/v1/docker", createDockerApi(core));
  app.route("/v1/request-log", createRequestLogApi(core));

  return app;
}
