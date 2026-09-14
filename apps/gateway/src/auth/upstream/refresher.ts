import { eq } from "drizzle-orm";
import { refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import type { AuthorizationServerMetadata, OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStatus } from "@junctio/schema";
import type { Db } from "../../db/index.ts";
import { servers } from "../../db/schema.ts";
import type { Logger } from "../../log.ts";
import { TokenStore, tokenSetFrom, type UpstreamOauthState } from "./store.ts";

export const SCHEDULER_INTERVAL_MS = 60_000;
const LONG_TTL_MS = 600_000;
const MIN_WINDOW_MS = 300_000;
const REFRESH_TIMEOUT_MS = 15_000;

export function refreshWindowMs(ttlSec: number | null): number {
  if (ttlSec === null || ttlSec <= 0) return MIN_WINDOW_MS;
  const ttlMs = ttlSec * 1000;
  const share = ttlMs * 0.2;
  return ttlMs <= LONG_TTL_MS ? share : Math.max(MIN_WINDOW_MS, share);
}

const OAUTH_ERROR_CODE =
  /\b(invalid_grant|invalid_client|invalid_request|invalid_scope|unauthorized_client|unsupported_grant_type|temporarily_unavailable|server_error)\b/i;

export function publicRefreshError(message: string): string {
  const match = OAUTH_ERROR_CODE.exec(message);
  return match?.[1]?.toLowerCase() ?? "the upstream authorization server rejected the refresh request";
}

export function needsRefresh(state: UpstreamOauthState, now = Date.now()): boolean {
  if (!state.tokens) return false;
  if (state.tokens.expiresAt === null) return false;
  return state.tokens.expiresAt - now < refreshWindowMs(state.tokens.ttlSec);
}

export type RefresherOptions = {
  db: Db;
  store: TokenStore;
  logger: Logger;
  fetchImpl?: typeof fetch;
  onStatusChange?: (serverId: string, status: OAuthStatus, reason: string | null) => void;
  intervalMs?: number;
};

export class UpstreamRefresher {
  private readonly inFlight = new Map<string, Promise<boolean>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  readonly stats = { refreshAttempts: 0, refreshSuccess: 0, refreshFailure: 0 };

  constructor(private readonly options: RefresherOptions) {}

  private readonly boundedFetch = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> => {
    const base = this.options.fetchImpl ?? fetch;
    return base(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(REFRESH_TIMEOUT_MS) });
  };

  start(): void {
    if (this.timer) return;
    const interval = this.options.intervalMs ?? SCHEDULER_INTERVAL_MS;
    this.timer = setInterval(() => void this.sweep(), interval);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private setStatus(serverId: string, status: OAuthStatus, reason: string | null): void {
    this.options.store.setStatus(serverId, status, reason);
    this.options.onStatusChange?.(serverId, status, reason);
  }

  async sweep(): Promise<void> {
    if (this.sweeping) {
      this.options.logger.debug("skipping overlapping refresh sweep");
      return;
    }
    this.sweeping = true;
    try {
      await this.runSweep();
    } finally {
      this.sweeping = false;
    }
  }

  private async runSweep(): Promise<void> {
    const rows = this.options.db.select().from(servers).where(eq(servers.authMode, "oauth")).all();
    for (const row of rows) {
      if (!row.enabled) continue;
      let state: UpstreamOauthState | null;
      try {
        state = await this.options.store.read(row.id);
      } catch (error) {
        this.options.logger.error("could not read stored upstream tokens", {
          server: row.id,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      if (!state?.tokens) continue;
      if (state.status === "needs_reauth") continue;
      if (!state.tokens.refreshToken) {
        if (state.status !== "no_refresh") this.setStatus(row.id, "no_refresh", "upstream did not issue a refresh token");
        continue;
      }
      if (!needsRefresh(state)) continue;
      this.options.logger.debug("proactive refresh scheduled", { server: row.id });
      await this.refresh(row.id).catch(() => undefined);
    }
  }

  async ensureFresh(serverId: string): Promise<string | null> {
    const state = await this.options.store.read(serverId);
    if (!state?.tokens) return null;
    if (!needsRefresh(state)) return state.tokens.accessToken;
    if (!state.tokens.refreshToken) {
      this.setStatus(serverId, "no_refresh", "upstream did not issue a refresh token");
      return state.tokens.accessToken;
    }
    const refreshed = await this.refresh(serverId);
    if (!refreshed) return state.tokens.accessToken;
    const next = await this.options.store.read(serverId);
    return next?.tokens?.accessToken ?? null;
  }

  refresh(serverId: string): Promise<boolean> {
    const existing = this.inFlight.get(serverId);
    if (existing) return existing;
    const promise = this.performRefresh(serverId).finally(() => this.inFlight.delete(serverId));
    this.inFlight.set(serverId, promise);
    return promise;
  }

  private async performRefresh(serverId: string): Promise<boolean> {
    const state = await this.options.store.read(serverId);
    if (!state?.tokens?.refreshToken) {
      if (state) this.setStatus(serverId, state.tokens ? "no_refresh" : "needs_reauth", "no refresh token stored");
      return false;
    }
    if (!state.authorizationServerUrl || !state.client) {
      this.setStatus(serverId, "needs_reauth", "oauth client is not registered");
      return false;
    }

    this.stats.refreshAttempts += 1;
    try {
      const tokens = await refreshAuthorization(state.authorizationServerUrl, {
        metadata: (state.asMetadata as AuthorizationServerMetadata | null) ?? undefined,
        clientInformation: {
          client_id: state.client.clientId,
          ...(state.client.clientSecret ? { client_secret: state.client.clientSecret } : {})
        } as OAuthClientInformationMixed,
        refreshToken: state.tokens.refreshToken,
        resource: state.resource ? new URL(state.resource) : undefined,
        fetchFn: this.boundedFetch
      });
      const next = tokenSetFrom(tokens);
      if (!next.refreshToken) next.refreshToken = state.tokens.refreshToken;
      await this.options.store.saveTokens(serverId, next, next.refreshToken ? "ok" : "no_refresh");
      this.stats.refreshSuccess += 1;
      this.options.onStatusChange?.(serverId, next.refreshToken ? "ok" : "no_refresh", null);
      this.options.logger.info("upstream token refreshed", {
        server: serverId,
        expiresInSec: next.ttlSec
      });
      return true;
    } catch (error) {
      this.stats.refreshFailure += 1;
      const message = error instanceof Error ? error.message : String(error);
      const permanent = /invalid_grant|invalid_client|unauthorized_client/i.test(message);
      this.setStatus(serverId, permanent ? "needs_reauth" : "expiring", publicRefreshError(message));
      this.options.logger[permanent ? "error" : "warn"]("upstream token refresh failed", {
        server: serverId,
        error: message,
        permanent
      });
      return false;
    }
  }

  markNeedsReauth(serverId: string, reason: string): void {
    this.setStatus(serverId, "needs_reauth", reason);
    this.options.logger.error("upstream requires re-authentication", { server: serverId, reason });
  }
}
