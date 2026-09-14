import { eq, lt } from "drizzle-orm";
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  registerClient,
  startAuthorization
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { AuthorizationServerMetadata, OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Db } from "../../db/index.ts";
import { oauthStates, servers } from "../../db/schema.ts";
import type { Logger } from "../../log.ts";
import { randomToken } from "../../crypto.ts";
import { TokenStore, tokenSetFrom, type ClientRegistration } from "./store.ts";

export const CALLBACK_PATH = "/oauth/upstream/callback";
export const STATE_TTL_MS = 600_000;

export type FlowOptions = {
  db: Db;
  store: TokenStore;
  logger: Logger;
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export type DiscoveryResult = {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata | undefined;
  resource: string | null;
  client: ClientRegistration;
};

export class UpstreamOauthFlow {
  constructor(private readonly options: FlowOptions) {}

  redirectUri(serverId: string): string {
    return `${this.options.baseUrl}${CALLBACK_PATH}/${serverId}`;
  }

  private serverUrl(serverId: string): string {
    const row = this.options.db.select().from(servers).where(eq(servers.id, serverId)).get();
    if (!row) throw new Error("server not found");
    if (row.transport !== "http" || !row.url) throw new Error("oauth is only supported for http upstreams");
    return row.url;
  }

  private scope(serverId: string): string | undefined {
    const row = this.options.db.select().from(servers).where(eq(servers.id, serverId)).get();
    return row?.oauthScope ?? undefined;
  }

  async discover(serverId: string): Promise<DiscoveryResult> {
    const fetchImpl = this.options.fetchImpl;
    const serverUrl = this.serverUrl(serverId);
    const info = await discoverOAuthServerInfo(serverUrl, fetchImpl ? { fetchFn: fetchImpl } : undefined);
    const resource = info.resourceMetadata?.resource ?? serverUrl;

    const existing = await this.options.store.read(serverId);
    let client = existing?.client ?? null;
    if (!client) {
      const registrationEndpoint = info.authorizationServerMetadata?.registration_endpoint;
      if (!registrationEndpoint) {
        throw new Error("upstream authorization server has no registration endpoint, set client_id manually");
      }
      const registered = await registerClient(info.authorizationServerUrl, {
        metadata: info.authorizationServerMetadata,
        clientMetadata: {
          client_name: "Junctio",
          redirect_uris: [this.redirectUri(serverId)],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: this.scope(serverId)
        },
        ...(fetchImpl ? { fetchFn: fetchImpl } : {})
      });
      client = { clientId: registered.client_id, clientSecret: registered.client_secret ?? null };
      this.options.logger.info("registered oauth client with upstream", { server: serverId });
    }

    await this.options.store.saveDiscovery(serverId, {
      issuer: info.authorizationServerMetadata?.issuer ?? null,
      authorizationServerUrl: info.authorizationServerUrl,
      asMetadata: (info.authorizationServerMetadata as Record<string, unknown> | undefined) ?? null,
      resource,
      client
    });

    return {
      authorizationServerUrl: info.authorizationServerUrl,
      metadata: info.authorizationServerMetadata,
      resource,
      client
    };
  }

  async start(serverId: string): Promise<string> {
    const discovery = await this.discover(serverId);
    const state = randomToken(32);
    const redirectUri = this.redirectUri(serverId);
    const { authorizationUrl, codeVerifier } = await startAuthorization(discovery.authorizationServerUrl, {
      metadata: discovery.metadata,
      clientInformation: { client_id: discovery.client.clientId } as OAuthClientInformationMixed,
      redirectUrl: redirectUri,
      scope: this.scope(serverId),
      state,
      resource: discovery.resource ? new URL(discovery.resource) : undefined
    });

    this.options.db
      .insert(oauthStates)
      .values({
        state,
        serverId,
        codeVerifier,
        redirectUri,
        resource: discovery.resource,
        createdAt: Date.now()
      })
      .run();

    return authorizationUrl.toString();
  }

  async complete(serverId: string, code: string, state: string): Promise<void> {
    const pending = this.options.db.select().from(oauthStates).where(eq(oauthStates.state, state)).get();
    if (!pending || pending.serverId !== serverId) throw new Error("unknown or expired authorization state");
    this.options.db.delete(oauthStates).where(eq(oauthStates.state, state)).run();
    if (pending.createdAt < Date.now() - STATE_TTL_MS) throw new Error("unknown or expired authorization state");

    const stored = await this.options.store.read(serverId);
    if (!stored?.client || !stored.authorizationServerUrl) throw new Error("oauth client is not registered");

    const fetchImpl = this.options.fetchImpl;
    const tokens = await exchangeAuthorization(stored.authorizationServerUrl, {
      metadata: (stored.asMetadata as AuthorizationServerMetadata | null) ?? undefined,
      clientInformation: {
        client_id: stored.client.clientId,
        ...(stored.client.clientSecret ? { client_secret: stored.client.clientSecret } : {})
      } as OAuthClientInformationMixed,
      authorizationCode: code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
      resource: pending.resource ? new URL(pending.resource) : undefined,
      ...(fetchImpl ? { fetchFn: fetchImpl } : {})
    });

    const tokenSet = tokenSetFrom(tokens);
    await this.options.store.saveTokens(serverId, tokenSet, tokenSet.refreshToken ? "ok" : "no_refresh");
    this.options.logger.info("upstream authorization completed", {
      server: serverId,
      hasRefreshToken: Boolean(tokenSet.refreshToken)
    });
  }

  pruneStates(maxAgeMs = STATE_TTL_MS): void {
    this.options.db.delete(oauthStates).where(lt(oauthStates.createdAt, Date.now() - maxAgeMs)).run();
  }
}
