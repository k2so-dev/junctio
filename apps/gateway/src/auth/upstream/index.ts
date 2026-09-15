import type { Db } from "../../db/index.ts";
import type { Cipher } from "../../crypto.ts";
import type { Logger } from "../../log.ts";
import type { ResolvedServer, UpstreamAuth } from "../../upstream/types.ts";
import { TokenStore } from "./store.ts";
import { UpstreamRefresher } from "./refresher.ts";
import { STATE_TTL_MS, UpstreamOauthFlow } from "./flow.ts";

export { TokenStore } from "./store.ts";
export { UpstreamRefresher, refreshWindowMs, needsRefresh } from "./refresher.ts";
export { UpstreamOauthFlow, CALLBACK_PATH, STATE_TTL_MS } from "./flow.ts";

export type UpstreamAuthServiceOptions = {
  db: Db;
  cipher: Cipher;
  logger: Logger;
  baseUrl: string | null;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
};

export class UpstreamAuthService implements UpstreamAuth {
  readonly store: TokenStore;
  readonly refresher: UpstreamRefresher;
  readonly flow: UpstreamOauthFlow | null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly options: UpstreamAuthServiceOptions) {
    this.store = new TokenStore(options.db, options.cipher);
    this.refresher = new UpstreamRefresher({
      db: options.db,
      store: this.store,
      logger: options.logger,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.intervalMs ? { intervalMs: options.intervalMs } : {})
    });
    this.flow = options.baseUrl
      ? new UpstreamOauthFlow({
          db: options.db,
          store: this.store,
          logger: options.logger,
          baseUrl: options.baseUrl,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
        })
      : null;
  }

  start(): void {
    this.refresher.start();
    const flow = this.flow;
    if (!flow || this.stateTimer) return;
    flow.pruneStates();
    this.stateTimer = setInterval(() => flow.pruneStates(), STATE_TTL_MS);
    this.stateTimer.unref?.();
  }

  stop(): void {
    this.refresher.stop();
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.stateTimer = null;
  }

  async authHeaders(server: ResolvedServer): Promise<Record<string, string>> {
    if (server.row.authMode !== "oauth") return {};
    const token = await this.refresher.ensureFresh(server.row.id);
    if (!token) return {};
    return { authorization: `Bearer ${token}` };
  }

  async handleUnauthorized(serverId: string): Promise<boolean> {
    const state = await this.store.read(serverId);
    if (!state?.tokens?.refreshToken) {
      this.refresher.markNeedsReauth(serverId, "upstream rejected the token and no refresh token is stored");
      return false;
    }
    return this.refresher.refresh(serverId);
  }

  markNeedsReauth(serverId: string, reason: string): void {
    this.refresher.markNeedsReauth(serverId, reason);
  }
}
