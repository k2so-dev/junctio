import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.ts";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'"
].join("; ");

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY");
    c.header("referrer-policy", "no-referrer");
    c.header("cross-origin-opener-policy", "same-origin");
    c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/") || path.startsWith("/mcp/") || path.startsWith("/oauth/")) {
      c.header("cache-control", "no-store");
      return;
    }
    c.header("content-security-policy", CSP);
  };
}
