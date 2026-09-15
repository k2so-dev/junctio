import { Hono } from "hono";
import type { Context, Next } from "hono";
import { authenticateClient, authorizeHandler, clientRegistrationHandler, revokeHandler, tokenHandler } from "@hono/mcp/auth";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { JunctioOAuthProvider } from "./provider.ts";
import type { AppEnv } from "../../../server/env.ts";
import { RateLimiter, clientAddress } from "../../../server/ratelimit.ts";

export const OAUTH_BASE_PATH = "/oauth";
export const AUTHORIZE_PATH = `${OAUTH_BASE_PATH}/authorize`;
export const TOKEN_PATH = `${OAUTH_BASE_PATH}/token`;
export const REGISTER_PATH = `${OAUTH_BASE_PATH}/register`;
export const REVOKE_PATH = `${OAUTH_BASE_PATH}/revoke`;

export function authorizationServerMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}${AUTHORIZE_PATH}`,
    token_endpoint: `${issuer}${TOKEN_PATH}`,
    registration_endpoint: `${issuer}${REGISTER_PATH}`,
    revocation_endpoint: `${issuer}${REVOKE_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    revocation_endpoint_auth_methods_supported: ["client_secret_post", "none"]
  };
}

export function createAuthorizationServerRoute(
  provider: JunctioOAuthProvider,
  options: { trustProxy: boolean }
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const sdkProvider = provider as unknown as OAuthServerProvider;
  const clientAuth = authenticateClient({ clientsStore: provider.clientsStore });
  const registrations = new RateLimiter(5, 60_000);
  const grants = new RateLimiter(30, 60_000);

  const throttle = (limiter: RateLimiter, message: string) => async (c: Context<AppEnv>, next: Next) => {
    const address = clientAddress(c.req.raw, { ip: c.env.ip, trustProxy: options.trustProxy });
    const limit = limiter.check(address);
    if (!limit.allowed) {
      c.header("retry-after", String(limit.retryAfterSec));
      return c.json({ error: "temporarily_unavailable", error_description: message }, 429);
    }
    return next();
  };

  app.on(["GET", "POST"], "/authorize", throttle(grants, "too many authorization requests"), authorizeHandler(sdkProvider));
  app.post("/token", throttle(grants, "too many token requests"), clientAuth, tokenHandler(sdkProvider));
  app.post(
    "/register",
    throttle(registrations, "too many client registrations"),
    async (c, next) => {
      provider.prune();
      return next();
    },
    clientRegistrationHandler({
      clientsStore: provider.clientsStore,
      clientIdGeneration: false,
      clientSecretExpirySeconds: 0
    })
  );
  app.post("/revoke", clientAuth, revokeHandler(sdkProvider));

  return app;
}
