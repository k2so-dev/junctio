import { eq } from "drizzle-orm";
import type { OAuthStatus } from "@junctio/schema";
import type { Db } from "../../db/index.ts";
import { upstreamOauth } from "../../db/schema.ts";
import type { UpstreamOauthRow } from "../../db/schema.ts";
import type { Cipher } from "../../crypto.ts";

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  ttlSec: number | null;
  scope: string | null;
};

export type ClientRegistration = {
  clientId: string;
  clientSecret: string | null;
};

export type UpstreamOauthState = {
  serverId: string;
  issuer: string | null;
  authorizationServerUrl: string | null;
  client: ClientRegistration | null;
  tokens: TokenSet | null;
  resource: string | null;
  asMetadata: Record<string, unknown> | null;
  status: OAuthStatus;
  lastRefreshAt: number | null;
  lastError: string | null;
};

export class TokenStore {
  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher
  ) {}

  row(serverId: string): UpstreamOauthRow | null {
    return this.db.select().from(upstreamOauth).where(eq(upstreamOauth.serverId, serverId)).get() ?? null;
  }

  async read(serverId: string): Promise<UpstreamOauthState | null> {
    const row = this.row(serverId);
    if (!row) return null;
    const accessToken = await this.cipher.decryptNullable(row.accessTokenEnc);
    const refreshToken = await this.cipher.decryptNullable(row.refreshTokenEnc);
    const clientSecret = await this.cipher.decryptNullable(row.clientSecretEnc);
    return {
      serverId,
      issuer: row.issuer,
      authorizationServerUrl: row.authorizationServerUrl,
      client: row.clientId ? { clientId: row.clientId, clientSecret } : null,
      tokens: accessToken
        ? {
            accessToken,
            refreshToken,
            expiresAt: row.expiresAt,
            ttlSec: row.tokenTtlSec,
            scope: row.scope
          }
        : null,
      resource: row.resource,
      asMetadata: row.asMetadata,
      status: row.status,
      lastRefreshAt: row.lastRefreshAt,
      lastError: row.lastError
    };
  }

  private upsert(serverId: string, values: Partial<typeof upstreamOauth.$inferInsert>): void {
    this.db
      .insert(upstreamOauth)
      .values({ serverId, ...values, updatedAt: Date.now() } as typeof upstreamOauth.$inferInsert)
      .onConflictDoUpdate({
        target: upstreamOauth.serverId,
        set: { ...values, updatedAt: Date.now() }
      })
      .run();
  }

  async saveDiscovery(
    serverId: string,
    input: {
      issuer: string | null;
      authorizationServerUrl: string;
      asMetadata: Record<string, unknown> | null;
      resource: string | null;
      client: ClientRegistration | null;
    }
  ): Promise<void> {
    this.upsert(serverId, {
      issuer: input.issuer,
      authorizationServerUrl: input.authorizationServerUrl,
      asMetadata: input.asMetadata,
      resource: input.resource,
      clientId: input.client?.clientId ?? null,
      clientSecretEnc: await this.cipher.encryptNullable(input.client?.clientSecret ?? null)
    });
  }

  async saveTokens(serverId: string, tokens: TokenSet, status: OAuthStatus): Promise<void> {
    const accessTokenEnc = await this.cipher.encrypt(tokens.accessToken);
    const refreshTokenEnc = await this.cipher.encryptNullable(tokens.refreshToken);
    this.db.transaction((tx) => {
      tx.insert(upstreamOauth)
        .values({
          serverId,
          accessTokenEnc,
          refreshTokenEnc,
          expiresAt: tokens.expiresAt,
          tokenTtlSec: tokens.ttlSec,
          scope: tokens.scope,
          status,
          lastRefreshAt: Date.now(),
          lastError: null,
          updatedAt: Date.now()
        })
        .onConflictDoUpdate({
          target: upstreamOauth.serverId,
          set: {
            accessTokenEnc,
            refreshTokenEnc,
            expiresAt: tokens.expiresAt,
            tokenTtlSec: tokens.ttlSec,
            scope: tokens.scope,
            status,
            lastRefreshAt: Date.now(),
            lastError: null,
            updatedAt: Date.now()
          }
        })
        .run();
    });
  }

  setStatus(serverId: string, status: OAuthStatus, error: string | null = null): void {
    this.upsert(serverId, { status, lastError: error });
  }

  clear(serverId: string): void {
    this.db.delete(upstreamOauth).where(eq(upstreamOauth.serverId, serverId)).run();
  }
}

export function tokenSetFrom(raw: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}): TokenSet {
  const ttl = typeof raw.expires_in === "number" ? raw.expires_in : null;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: ttl === null ? null : Date.now() + ttl * 1000,
    ttlSec: ttl,
    scope: raw.scope ?? null
  };
}
