import { Hono } from "hono";
import type { Core } from "../core.ts";

export function createUpstreamOauthRoute(core: Core): Hono {
  const app = new Hono();

  app.get("/callback/:serverId", async (c) => {
    const serverId = c.req.param("serverId");
    const url = new URL(c.req.url);
    const error = url.searchParams.get("error");
    if (error) {
      const description = url.searchParams.get("error_description") ?? "";
      core.logger.warn("upstream authorization denied", { server: serverId, error });
      return c.html(page("Authorization failed", `${error}. ${description}`), 400);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return c.html(page("Authorization failed", "missing code or state"), 400);

    const flow = core.upstreamAuth.flow;
    if (!flow) return c.html(page("Authorization failed", "JUNCTIO_BASE_URL is not configured"), 500);

    try {
      await flow.complete(serverId, code, state, url.searchParams.get("iss"));
      await core.pool.invalidate(serverId, "upstream authorization completed");
      return c.html(page("Connected", "You can close this tab and return to Junctio."));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      core.logger.error("upstream authorization exchange failed", { server: serverId, error: message });
      return c.html(page("Authorization failed", message), 400);
    }
  });

  return app;
}

function page(title: string, message: string): string {
  const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
body{background:#0a0a0a;color:#fafafa;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#a1a1aa;margin:0}
</style></head><body><main><h1>${escape(title)}</h1><p>${escape(message)}</p></main></body></html>`;
}
