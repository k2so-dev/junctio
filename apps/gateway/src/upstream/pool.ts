import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  type Prompt,
  type Resource,
  type ServerCapabilities,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "../log.ts";
import { VERSION } from "../config.ts";
import type { ProcessSupervisor } from "./supervisor.ts";
import type { ServerRegistry } from "./registry.ts";
import { createHttpTransport } from "./http.ts";
import { UpstreamError, type UpstreamAuth } from "./types.ts";
import type { LogRegistry } from "./logbuffer.ts";

export type Catalog = {
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  capabilities: ServerCapabilities | undefined;
  fetchedAt: number;
};

type Entry = {
  serverId: string;
  client: Client;
  transport: Transport;
  generation: number;
  catalog: Catalog | null;
  closing: boolean;
};

export type PoolOptions = {
  registry: ServerRegistry;
  supervisor: ProcessSupervisor;
  auth: UpstreamAuth;
  logger: Logger;
  logs: LogRegistry;
  listTimeoutMs?: number;
  callTimeoutMs?: number;
};

const EMPTY_CATALOG: Catalog = {
  tools: [],
  resources: [],
  prompts: [],
  capabilities: undefined,
  fetchedAt: 0
};

export class UpstreamPool {
  private readonly entries = new Map<string, Entry>();
  private readonly connecting = new Map<string, Promise<Entry>>();
  private readonly lastError = new Map<string, string>();
  readonly listTimeoutMs: number;
  readonly callTimeoutMs: number;

  constructor(private readonly options: PoolOptions) {
    this.listTimeoutMs = options.listTimeoutMs ?? 5_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 120_000;
  }

  getLastError(serverId: string): string | null {
    return this.lastError.get(serverId) ?? null;
  }

  cachedCatalog(serverId: string): Catalog | null {
    return this.entries.get(serverId)?.catalog ?? null;
  }

  async invalidate(serverId: string, reason = "config changed"): Promise<void> {
    this.options.registry.invalidate(serverId);
    const entry = this.entries.get(serverId);
    if (!entry) return;
    this.entries.delete(serverId);
    entry.closing = true;
    this.options.logger.debug("closing upstream client", { server: serverId, reason });
    await entry.client.close().catch(() => undefined);
  }

  invalidateCatalog(serverId: string): void {
    const entry = this.entries.get(serverId);
    if (entry) entry.catalog = null;
  }

  onProcessExit(serverId: string, generation: number): void {
    const entry = this.entries.get(serverId);
    if (!entry || entry.generation !== generation) return;
    this.entries.delete(serverId);
    void entry.client.close().catch(() => undefined);
  }

  private async connect(serverId: string): Promise<Entry> {
    const resolved = await this.options.registry.resolve(serverId);
    if (!resolved) throw new UpstreamError("server not found", "not_found", serverId);
    if (!resolved.row.enabled) throw new UpstreamError("server is disabled", "disabled", serverId);

    let transport: Transport;
    let generation = 0;
    if (resolved.row.transport === "stdio") {
      const handle = await this.options.supervisor.acquire(serverId);
      transport = handle.transport;
      generation = handle.generation;
    } else {
      transport = createHttpTransport({
        server: resolved,
        auth: this.options.auth,
        logger: this.options.logger,
        onUnauthorized: () => {
          this.options.logs.append(serverId, "system", "upstream rejected the token");
          this.options.auth.markNeedsReauth?.(serverId, "upstream returned 401 after a refresh attempt");
        }
      });
    }

    const client = new Client({ name: "junctio", version: VERSION }, { capabilities: {} });
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      this.options.logger.debug("upstream tool list changed", { server: serverId });
      this.invalidateCatalog(serverId);
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      this.invalidateCatalog(serverId);
    });
    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      this.invalidateCatalog(serverId);
    });
    client.onclose = () => {
      const current = this.entries.get(serverId);
      if (current?.client === client) this.entries.delete(serverId);
    };

    await client.connect(transport, { timeout: this.listTimeoutMs * 2 });
    const entry: Entry = { serverId, client, transport, generation, catalog: null, closing: false };
    this.entries.set(serverId, entry);
    this.lastError.delete(serverId);
    return entry;
  }

  async acquire(serverId: string): Promise<Client> {
    const existing = this.entries.get(serverId);
    if (existing && !existing.closing) {
      this.options.supervisor.touch(serverId);
      return existing.client;
    }
    const pending = this.connecting.get(serverId);
    if (pending) return (await pending).client;
    const promise = this.connect(serverId).finally(() => this.connecting.delete(serverId));
    this.connecting.set(serverId, promise);
    try {
      return (await promise).client;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError.set(serverId, message);
      throw error;
    }
  }

  private isRecoverable(error: unknown): boolean {
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
      await this.invalidate(serverId, "recoverable error");
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
      const timeout = this.listTimeoutMs;
      const tools = capabilities?.tools ? (await client.listTools(undefined, { timeout })).tools : [];
      const resources = capabilities?.resources ? (await client.listResources(undefined, { timeout })).resources : [];
      const prompts = capabilities?.prompts ? (await client.listPrompts(undefined, { timeout })).prompts : [];
      const catalog: Catalog = { tools, resources, prompts, capabilities, fetchedAt: Date.now() };
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
    await Promise.allSettled(all.map((entry) => entry.client.close()));
  }
}
