import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { Hono } from "hono";
import type { HealthDto } from "@junctio/schema";
import type { Core } from "../core.ts";
import { servers, upstreamOauth } from "../db/schema.ts";
import { createMcpRoute } from "./mcp.ts";
import type { AppEnv } from "./env.ts";
import { createAdminMcpRoute } from "./admin.ts";
import { createWellKnownRoute } from "./wellknown.ts";
import { createUpstreamOauthRoute } from "./oauth.ts";
import { createApi } from "../api/index.ts";
import { RemoteJwtVerifier } from "../auth/downstream/jwt.ts";
import type { JwtVerifier } from "../auth/downstream/middleware.ts";
import { createAuthorizationServerRoute } from "../auth/downstream/as/index.ts";
import { LocalTokenVerifier } from "../auth/downstream/as/verifier.ts";

export type AppOptions = {
  core: Core;
  verifier?: JwtVerifier | null;
  publicDir?: string | null;
};

function resolvePublicDir(explicit?: string | null): string | null {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const fromEnv = Bun.env.JUNCTIO_PUBLIC_DIR;
  const candidates = [fromEnv, join(process.cwd(), "public"), join(process.cwd(), "apps", "web", "dist")].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}

export function buildHealth(core: Core): HealthDto {
  const rows = core.db.select().from(servers).all();
  const oauthStatus = new Map(core.db.select().from(upstreamOauth).all().map((row) => [row.serverId, row.status]));
  let running = 0;
  let failed = 0;
  let needsReauth = 0;
  for (const row of rows) {
    if (!row.enabled) continue;
    if (row.authMode === "oauth") {
      const status = oauthStatus.get(row.id) ?? "needs_reauth";
      if (status === "needs_reauth" || status === "no_refresh") needsReauth += 1;
    }
    if (row.transport !== "stdio") {
      if (core.pool.cachedCatalog(row.id)) running += 1;
      continue;
    }
    const info = core.supervisor.getInfo(row.id);
    if (info.state === "running") running += 1;
    if (info.state === "failed") failed += 1;
  }
  return {
    status: failed > 0 || needsReauth > 0 ? "degraded" : "ok",
    version: core.config.version,
    uptimeSec: Math.floor((Date.now() - core.startedAt) / 1000),
    servers: { total: rows.length, running, failed, needsReauth }
  };
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const { core } = options;
  const app = new Hono<AppEnv>();
  const publicDir = resolvePublicDir(options.publicDir);
  const remote = core.config.oauthIssuer
    ? new RemoteJwtVerifier(core.config.oauthIssuer, core.config.oauthAudience)
    : null;
  const verifier = options.verifier ?? remote ?? new LocalTokenVerifier(core.oauthProvider);

  app.get("/health", (c) => c.json(buildHealth(core)));

  app.route("/.well-known", createWellKnownRoute({ core, remote }));
  app.route("/mcp", createAdminMcpRoute({ core, verifier: remote ? null : verifier }));
  app.route("/mcp", createMcpRoute({ core, verifier }));
  app.route("/oauth/upstream", createUpstreamOauthRoute(core));
  if (!remote) app.route("/oauth", createAuthorizationServerRoute(core.oauthProvider));
  app.route("/api", createApi(core));

  if (publicDir) {
    app.get("/assets/*", async (c) => {
      const path = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
      const file = Bun.file(join(publicDir, path));
      if (!(await file.exists())) return c.notFound();
      return new Response(file, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
    });
    app.get("*", async (c) => {
      const pathname = new URL(c.req.url).pathname;
      if (pathname.startsWith("/api/") || pathname.startsWith("/mcp/")) return c.notFound();
      const direct = Bun.file(join(publicDir, normalize(pathname).replace(/^(\.\.[/\\])+/, "")));
      if (pathname !== "/" && (await direct.exists())) return new Response(direct);
      return new Response(Bun.file(join(publicDir, "index.html")), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    });
  }

  return app;
}
