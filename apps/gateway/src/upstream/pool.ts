import {
  Client,
  SdkError,
  SdkErrorCode,
  SseError,
  type McpSubscription,
  type PriorDiscovery,
  type Prompt,
  type ProtocolEra,
  type Resource,
  type ServerCapabilities,
  type SubscriptionFilter,
  type Tool,
  type Transport
} from "@modelcontextprotocol/client";
import type { Logger } from "../log.ts";
import { VERSION } from "../config.ts";
import type { ProcessSupervisor } from "./supervisor.ts";
import type { ServerRegistry } from "./registry.ts";
import type { LaunchGate } from "./gate.ts";
import { createRemoteTransport } from "./http.ts";
import { UpstreamError, type UpstreamAuth } from "./types.ts";
import type { LogRegistry } from "./logbuffer.ts";

export type Catalog = {
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  capabilities: ServerCapabilities | undefined;
  instructions: string | null;
  fetchedAt: number;
};

export type Negotiated = {
  era: ProtocolEra;
  protocolVersion: string | null;
};

type Entry = {
  serverId: string;
  client: Client;
  transport: Transport;
  generation: number;
  catalog: Catalog | null;
  closing: boolean;
  subscription: McpSubscription | null;
};

type Verdict = {
  prior: PriorDiscovery;
  storedAt: number;
};

export type PoolOptions = {
  registry: ServerRegistry;
  supervisor: ProcessSupervisor;
  gate: LaunchGate;
  auth: UpstreamAuth;
  logger: Logger;
  logs: LogRegistry;
  listTimeoutMs?: number;
  callTimeoutMs?: number;
  probeTimeoutMs?: number;
  verdictTtlMs?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
};

export const EMPTY_CATALOG: Catalog = {
  tools: [],
  resources: [],
  prompts: [],
  capabilities: undefined,
  instructions: null,
  fetchedAt: 0
};

function isEraFailure(error: unknown): boolean {
  return SdkError.isInstance(error) && error.code === SdkErrorCode.EraNegotiationFailed;
}

function listenFilter(capabilities: ServerCapabilities | undefined): SubscriptionFilter | null {
  const filter: SubscriptionFilter = {};
  if (capabilities?.tools?.listChanged) filter.toolsListChanged = true;
  if (capabilities?.resources?.listChanged) filter.resourcesListChanged = true;
  if (capabilities?.prompts?.listChanged) filter.promptsListChanged = true;
  return Object.keys(filter).length > 0 ? filter : null;
}

export class UpstreamPool {
  private readonly entries = new Map<string, Entry>();
  private readonly connecting = new Map<string, Promise<Entry>>();
  private readonly lastError = new Map<string, string>();
  private readonly verdicts = new Map<string, Verdict>();
  private readonly backoff = new Map<string, { failures: number; until: number }>();
  readonly listTimeoutMs: number;
  readonly callTimeoutMs: number;
  readonly probeTimeoutMs: number;
  readonly verdictTtlMs: number;
  readonly backoffBaseMs: number;
  readonly backoffCapMs: number;

  constructor(private readonly options: PoolOptions) {
    this.listTimeoutMs = options.listTimeoutMs ?? 5_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 120_000;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 3_000;
    this.verdictTtlMs = options.verdictTtlMs ?? 24 * 60 * 60_000;
    this.backoffBaseMs = options.backoffBaseMs ?? 1_000;
    this.backoffCapMs = options.backoffCapMs ?? 60_000;
  }

  getLastError(serverId: string): string | null {
    return this.lastError.get(serverId) ?? null;
  }

  cachedCatalog(serverId: string): Catalog | null {
    return this.entries.get(serverId)?.catalog ?? null;
  }

  negotiated(serverId: string): Negotiated | null {
    const entry = this.entries.get(serverId);
    if (!entry) return null;
    const era = entry.client.getProtocolEra();
    if (!era) return null;
    return { era, protocolVersion: entry.client.getNegotiatedProtocolVersion() ?? null };
  }

  private async closeEntry(entry: Entry): Promise<void> {
    await entry.subscription?.close().catch(() => undefined);
    await entry.client.close().catch(() => undefined);
  }

  private async drop(serverId: string, reason: string): Promise<void> {
    const entry = this.entries.get(serverId);
    if (!entry) return;
    this.entries.delete(serverId);
    entry.closing = true;
    this.options.logger.debug("closing upstream client", { server: serverId, reason });
    await this.closeEntry(entry);
  }

  async invalidate(serverId: string, reason = "config changed"): Promise<void> {
    this.options.registry.invalidate(serverId);
    this.verdicts.delete(serverId);
    this.backoff.delete(serverId);
    await this.drop(serverId, reason);
  }

  invalidateCatalog(serverId: string): void {
    const entry = this.entries.get(serverId);
    if (entry) entry.catalog = null;
  }

  onProcessExit(serverId: string, generation: number): void {
    const entry = this.entries.get(serverId);
    if (!entry || entry.generation !== generation) return;
    this.entries.delete(serverId);
    void this.closeEntry(entry);
  }

  private evict(serverId: string, client: Client, reason: string): void {
    const entry = this.entries.get(serverId);
    this.options.logger.debug("dropping upstream client", { server: serverId, reason });
    if (entry?.client === client) {
      this.entries.delete(serverId);
      void this.closeEntry(entry);
      return;
    }
    void client.close().catch(() => undefined);
  }

  private prior(serverId: string): PriorDiscovery | undefined {
    const verdict = this.verdicts.get(serverId);
    if (!verdict) return undefined;
    if (Date.now() - verdict.storedAt > this.verdictTtlMs) {
      this.verdicts.delete(serverId);
      return undefined;
    }
    return verdict.prior;
  }

  private remember(serverId: string, client: Client): void {
    const discover = client.getDiscoverResult();
    this.verdicts.set(serverId, {
      prior: discover ? { kind: "modern", discover } : { kind: "legacy" },
      storedAt: Date.now()
    });
  }

  private async openTransport(serverId: string): Promise<{ transport: Transport; generation: number }> {
    const resolved = await this.options.gate.assert(serverId);
    if (resolved.row.transport === "stdio") {
      const handle = await this.options.supervisor.acquire(serverId);
      return { transport: handle.transport, generation: handle.generation };
    }
    const transport = createRemoteTransport({
      server: resolved,
      auth: this.options.auth,
      logger: this.options.logger,
      onUnauthorized: () => {
        this.options.logs.append(serverId, "system", "upstream rejected the token");
        this.options.auth.markNeedsReauth?.(serverId, "upstream returned 401 after a refresh attempt");
      }
    });
    return { transport, generation: 0 };
  }

  private buildClient(serverId: string): Client {
    const client = new Client(
      { name: "junctio", version: VERSION },
      {
        capabilities: {},
        versionNegotiation: { mode: "auto", probe: { timeoutMs: this.probeTimeoutMs } }
      }
    );
    client.setNotificationHandler("notifications/tools/list_changed", async () => {
      this.options.logger.debug("upstream tool list changed", { server: serverId });
      this.invalidateCatalog(serverId);
    });
    client.setNotificationHandler("notifications/resources/list_changed", async () => {
      this.invalidateCatalog(serverId);
    });
    client.setNotificationHandler("notifications/prompts/list_changed", async () => {
      this.invalidateCatalog(serverId);
    });
    client.onerror = (error) => {
      if (!(error instanceof SseError)) return;
      this.options.logs.append(serverId, "system", "sse stream dropped, reconnecting on the next call");
      this.evict(serverId, client, "sse stream dropped");
    };
    client.onclose = () => {
      const current = this.entries.get(serverId);
      if (current?.client !== client) return;
      this.entries.delete(serverId);
      void current.subscription?.close().catch(() => undefined);
    };
    return client;
  }

  private async subscribe(serverId: string, client: Client): Promise<McpSubscription | null> {
    if (client.getProtocolEra() !== "modern") return null;
    const filter = listenFilter(client.getServerCapabilities());
    if (!filter) return null;
    try {
      return await client.listen(filter, { timeout: this.listTimeoutMs });
    } catch (error) {
      this.options.logger.debug("upstream change stream unavailable", { server: serverId, error: String(error) });
      return null;
    }
  }

  private probeCasualty(serverId: string, generation: number, error: unknown): boolean {
    if (isEraFailure(error)) return true;
    if (generation === 0) return false;
    const info = this.options.supervisor.getInfo(serverId);
    return !this.options.supervisor.isRunning(serverId) || info.generation !== generation;
  }

  private async connect(serverId: string): Promise<Entry> {
    const timeout = this.listTimeoutMs * 2;
    let prior = this.prior(serverId);
    let { transport, generation } = await this.openTransport(serverId);
    let client = this.buildClient(serverId);
    try {
      await client.connect(transport, { timeout, ...(prior ? { prior } : {}) });
    } catch (error) {
      if (prior || !this.probeCasualty(serverId, generation, error)) throw error;
      this.options.logger.info("upstream did not survive the protocol probe, assuming legacy", {
        server: serverId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.options.logs.append(serverId, "system", "did not answer the 2026-07-28 probe, falling back to initialize");
      await client.close().catch(() => undefined);
      prior = { kind: "legacy" };
      this.verdicts.set(serverId, { prior, storedAt: Date.now() });
      if (generation !== 0) {
        await this.options.supervisor.stop(serverId).catch(() => undefined);
        this.options.supervisor.reset(serverId);
      }
      ({ transport, generation } = await this.openTransport(serverId));
      client = this.buildClient(serverId);
      await client.connect(transport, { timeout, prior });
    }
    if (!prior) this.remember(serverId, client);
    const subscription = await this.subscribe(serverId, client);
    const entry: Entry = { serverId, client, transport, generation, catalog: null, closing: false, subscription };
    this.entries.set(serverId, entry);
    this.lastError.delete(serverId);
    this.options.logger.debug("upstream connected", {
      server: serverId,
      era: client.getProtocolEra(),
      protocol: client.getNegotiatedProtocolVersion()
    });
    return entry;
  }

  private recordFailure(serverId: string): void {
    if (this.options.registry.row(serverId)?.transport === "stdio") return;
    const failures = (this.backoff.get(serverId)?.failures ?? 0) + 1;
    const delay = Math.min(this.backoffCapMs, this.backoffBaseMs * 2 ** (failures - 1));
    this.backoff.set(serverId, { failures, until: Date.now() + delay });
    this.options.logger.debug("upstream connect failed, backing off", { server: serverId, failures, delay });
  }

  async acquire(serverId: string): Promise<Client> {
    const existing = this.entries.get(serverId);
    if (existing && !existing.closing) {
      this.options.supervisor.touch(serverId);
      return existing.client;
    }
    const pending = this.connecting.get(serverId);
    if (pending) return (await pending).client;
    const blocked = this.backoff.get(serverId);
    if (blocked && Date.now() < blocked.until) {
      throw new UpstreamError(this.lastError.get(serverId) ?? "upstream is unavailable", "backoff", serverId);
    }
    const promise = this.connect(serverId).finally(() => this.connecting.delete(serverId));
    this.connecting.set(serverId, promise);
    try {
      const entry = await promise;
      this.backoff.delete(serverId);
      return entry.client;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError.set(serverId, message);
      this.recordFailure(serverId);
      throw error;
    }
  }

  private isRecoverable(error: unknown): boolean {
    if (SdkError.isInstance(error)) {
      return error.code === SdkErrorCode.ConnectionClosed || error.code === SdkErrorCode.NotConnected;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /404|session|not connected|closed|EPIPE|terminated/i.test(message);
  }

  async withClient<T>(serverId: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.acquire(serverId);
    try {
      const result = await fn(client);
      this.options.supervisor.touch(serverId);
      return result;
    } catch (error) {
      if (!this.isRecoverable(error)) {
        this.lastError.set(serverId, error instanceof Error ? error.message : String(error));
        throw error;
      }
      this.options.logger.warn("upstream call failed, reconnecting", {
        server: serverId,
        error: String(error)
      });
      await this.drop(serverId, "recoverable error");
      const retryClient = await this.acquire(serverId);
      return fn(retryClient);
    }
  }

  async catalog(serverId: string, force = false): Promise<Catalog> {
    const existing = this.entries.get(serverId);
    if (!force && existing?.catalog) return existing.catalog;
    return this.withClient(serverId, async (client) => {
      const entry = this.entries.get(serverId);
      if (!force && entry?.catalog) return entry.catalog;
      const capabilities = client.getServerCapabilities();
      const instructions = client.getInstructions()?.trim() || null;
      const timeout = this.listTimeoutMs;
      const tools = capabilities?.tools ? (await client.listTools(undefined, { timeout })).tools : [];
      const resources = capabilities?.resources ? (await client.listResources(undefined, { timeout })).resources : [];
      const prompts = capabilities?.prompts ? (await client.listPrompts(undefined, { timeout })).prompts : [];
      const catalog: Catalog = { tools, resources, prompts, capabilities, instructions, fetchedAt: Date.now() };
      const target = this.entries.get(serverId);
      if (target) target.catalog = catalog;
      return catalog;
    });
  }

  async safeCatalog(serverId: string): Promise<Catalog> {
    const cached = this.entries.get(serverId)?.catalog;
    if (cached) return cached;
    try {
      return await this.withTimeout(this.catalog(serverId), this.listTimeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError.set(serverId, message);
      this.options.logger.warn("upstream catalog unavailable", { server: serverId, error: message });
      return EMPTY_CATALOG;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  async shutdown(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(all.map((entry) => this.closeEntry(entry)));
  }
}
