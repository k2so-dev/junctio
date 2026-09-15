import { and, eq, isNull, lt } from "drizzle-orm";
import type { Context } from "hono";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidRequestError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Db } from "../../../db/index.ts";
import { oauthAuthCodes, oauthAuthRequests, oauthClients, oauthTokens } from "../../../db/schema.ts";
import type { Cipher } from "../../../crypto.ts";
import { randomId, randomToken, sha256Hex } from "../../../crypto.ts";
import { SqliteClientsStore } from "./clients.ts";

export const ACCESS_TOKEN_TTL_SEC = 3600;
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 3600;
const CODE_TTL_MS = 60_000;
const REQUEST_TTL_MS = 10 * 60_000;
const UNUSED_CLIENT_TTL_MS = 24 * 3600_000;

export type PendingRequest = {
  id: string;
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  scopes: string[];
  resource: string | null;
  expiresAt: number;
};

function errorRedirect(redirectUri: string, state: string | null, error: string, description: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export class JunctioOAuthProvider {
  readonly clientsStore: SqliteClientsStore;

  constructor(
    private readonly db: Db,
    cipher: Cipher,
    private readonly consentPath = "/consent"
  ) {
    this.clientsStore = new SqliteClientsStore(db, cipher);
  }

  prune(now = Date.now()): void {
    this.db.delete(oauthAuthRequests).where(lt(oauthAuthRequests.expiresAt, now)).run();
    this.db.delete(oauthAuthCodes).where(lt(oauthAuthCodes.expiresAt, now)).run();
    this.db.delete(oauthTokens).where(lt(oauthTokens.expiresAt, now - REFRESH_TOKEN_TTL_SEC * 1000)).run();
    this.db
      .delete(oauthClients)
      .where(and(isNull(oauthClients.lastUsedAt), lt(oauthClients.createdAt, now - UNUSED_CLIENT_TTL_MS)))
      .run();
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, c: Context): Promise<void> {
    if (!params.resource) {
      throw new InvalidRequestError("the resource parameter is required, see RFC 8707");
    }
    this.prune();
    const id = randomId();
    this.db
      .insert(oauthAuthRequests)
      .values({
        id,
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state ?? null,
        scopes: params.scopes ?? [],
        resource: params.resource.href,
        createdAt: Date.now(),
        expiresAt: Date.now() + REQUEST_TTL_MS
      })
      .run();
    c.res = c.redirect(`${this.consentPath}?request=${encodeURIComponent(id)}`);
  }

  pending(id: string): PendingRequest | null {
    const row = this.db
      .select({ request: oauthAuthRequests, clientName: oauthClients.clientName })
      .from(oauthAuthRequests)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthAuthRequests.clientId))
      .where(eq(oauthAuthRequests.id, id))
      .get();
    if (!row || row.request.expiresAt <= Date.now()) return null;
    return {
      id: row.request.id,
      clientId: row.request.clientId,
      clientName: row.clientName,
      redirectUri: row.request.redirectUri,
      scopes: row.request.scopes,
      resource: row.request.resource,
      expiresAt: row.request.expiresAt
    };
  }

  approve(id: string): string | null {
    const row = this.db.select().from(oauthAuthRequests).where(eq(oauthAuthRequests.id, id)).get();
    if (!row || row.expiresAt <= Date.now()) return null;
    const code = `jna_${randomToken(40)}`;
    this.db.transaction((tx) => {
      tx.insert(oauthAuthCodes)
        .values({
          codeHash: sha256Hex(code),
          clientId: row.clientId,
          redirectUri: row.redirectUri,
          codeChallenge: row.codeChallenge,
          scopes: row.scopes,
          resource: row.resource,
          createdAt: Date.now(),
          expiresAt: Date.now() + CODE_TTL_MS
        })
        .run();
      tx.delete(oauthAuthRequests).where(eq(oauthAuthRequests.id, id)).run();
    });
    const url = new URL(row.redirectUri);
    url.searchParams.set("code", code);
    if (row.state) url.searchParams.set("state", row.state);
    return url.toString();
  }

  deny(id: string): string | null {
    const row = this.db.select().from(oauthAuthRequests).where(eq(oauthAuthRequests.id, id)).get();
    if (!row) return null;
    this.db.delete(oauthAuthRequests).where(eq(oauthAuthRequests.id, id)).run();
    return errorRedirect(row.redirectUri, row.state, "access_denied", "the administrator denied this request");
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const row = this.db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, sha256Hex(authorizationCode))).get();
    if (!row || row.clientId !== client.client_id || row.expiresAt <= Date.now()) {
      throw new InvalidGrantError("authorization code is invalid or expired");
    }
    return row.codeChallenge;
  }

  private issue(clientId: string, scopes: string[], resource: string, grantedAt = Date.now()): OAuthTokens {
    const accessToken = `jnt_${randomToken(48)}`;
    const refreshToken = `jnr_${randomToken(48)}`;
    this.db
      .insert(oauthTokens)
      .values({
        id: randomId(),
        clientId,
        accessTokenHash: sha256Hex(accessToken),
        refreshTokenHash: sha256Hex(refreshToken),
        scopes,
        resource,
        expiresAt: Date.now() + ACCESS_TOKEN_TTL_SEC * 1000,
        createdAt: grantedAt
      })
      .run();
    this.clientsStore.touch(clientId);
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SEC,
      refresh_token: refreshToken,
      ...(scopes.length > 0 ? { scope: scopes.join(" ") } : {})
    };
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const codeHash = sha256Hex(authorizationCode);
    const row = this.db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, codeHash)).get();
    if (!row || row.clientId !== client.client_id || row.expiresAt <= Date.now()) {
      throw new InvalidGrantError("authorization code is invalid or expired");
    }
    if (redirectUri !== undefined && redirectUri !== row.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    if (row.resource === null) {
      throw new InvalidGrantError("the authorization request carried no resource");
    }
    if (resource !== undefined && resource.href !== row.resource) {
      throw new InvalidGrantError("resource does not match the authorization request");
    }
    this.db.delete(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, codeHash)).run();
    return this.issue(client.client_id, row.scopes, row.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const hash = sha256Hex(refreshToken);
    const row = this.db.select().from(oauthTokens).where(eq(oauthTokens.refreshTokenHash, hash)).get();
    if (!row || row.clientId !== client.client_id) {
      throw new InvalidGrantError("refresh token is invalid");
    }
    if (row.createdAt + REFRESH_TOKEN_TTL_SEC * 1000 <= Date.now()) {
      this.db.delete(oauthTokens).where(eq(oauthTokens.id, row.id)).run();
      throw new InvalidGrantError("refresh token has expired");
    }
    if (row.resource === null) {
      this.db.delete(oauthTokens).where(eq(oauthTokens.id, row.id)).run();
      throw new InvalidGrantError("the grant carried no resource");
    }
    if (resource !== undefined && resource.href !== row.resource) {
      throw new InvalidGrantError("resource does not match the original grant");
    }
    const granted = scopes && scopes.length > 0 ? scopes.filter((scope) => row.scopes.includes(scope)) : row.scopes;
    if (scopes && granted.length !== scopes.length) {
      throw new InvalidGrantError("requested scope exceeds the original grant");
    }
    return this.db.transaction((tx) => {
      tx.delete(oauthTokens).where(eq(oauthTokens.id, row.id)).run();
      return this.issue(client.client_id, granted, row.resource as string, row.createdAt);
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = this.db.select().from(oauthTokens).where(eq(oauthTokens.accessTokenHash, sha256Hex(token))).get();
    if (!row) throw new InvalidTokenError("unknown access token");
    if (row.expiresAt <= Date.now()) throw new InvalidTokenError("access token has expired");
    this.db.update(oauthTokens).set({ lastUsedAt: Date.now() }).where(eq(oauthTokens.id, row.id)).run();
    return {
      token,
      clientId: row.clientId,
      scopes: row.scopes,
      expiresAt: Math.floor(row.expiresAt / 1000),
      ...(row.resource ? { resource: new URL(row.resource) } : {})
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hash = sha256Hex(request.token);
    this.db
      .delete(oauthTokens)
      .where(and(eq(oauthTokens.clientId, client.client_id), eq(oauthTokens.accessTokenHash, hash)))
      .run();
    this.db
      .delete(oauthTokens)
      .where(and(eq(oauthTokens.clientId, client.client_id), eq(oauthTokens.refreshTokenHash, hash)))
      .run();
  }
}
