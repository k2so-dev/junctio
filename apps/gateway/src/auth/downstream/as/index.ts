import { Hono } from "hono";
import { authenticateClient, authorizeHandler, clientRegistrationHandler, revokeHandler, tokenHandler } from "@hono/mcp/auth";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { JunctioOAuthProvider } from "./provider.ts";

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

export function createAuthorizationServerRoute(provider: JunctioOAuthProvider): Hono {
  const app = new Hono();
  const sdkProvider = provider as unknown as OAuthServerProvider;
  const clientAuth = authenticateClient({ clientsStore: provider.clientsStore });

  app.on(["GET", "POST"], "/authorize", authorizeHandler(sdkProvider));
  app.post("/token", clientAuth, tokenHandler(sdkProvider));
  app.post(
    "/register",
    clientRegistrationHandler({
      clientsStore: provider.clientsStore,
      clientIdGeneration: false,
      clientSecretExpirySeconds: 0
    })
  );
  app.post("/revoke", clientAuth, revokeHandler(sdkProvider));

  return app;
}
