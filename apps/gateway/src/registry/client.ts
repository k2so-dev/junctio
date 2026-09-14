import { eq, lt } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/index.ts";
import { registryCache } from "../db/schema.ts";
import type { Logger } from "../log.ts";
import { VERSION } from "../config.ts";
import { RegistryEntry, RegistryListBody, RegistryProblem } from "./types.ts";

export const REGISTRY_URL = "https://registry.modelcontextprotocol.io";

const TTL_MS = 3_600_000;
const SWEEP_MS = 86_400_000;
const TIMEOUT_MS = 10_000;

export class RegistryError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
  }
}

export type RegistryResult<T> = {
  body: T;
  fetchedAt: number;
  stale: boolean;
  error: string | null;
};

export type RegistryClientOptions = {
  db: Db;
  logger: Logger;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  ttlMs?: number;
};

export type RegistryListQuery = {
  search?: string | undefined;
  cursor?: string | undefined;
  limit: number;
  refresh?: boolean;
};

export class RegistryClient {
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;

  constructor(options: RegistryClientOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? REGISTRY_URL;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.ttlMs = options.ttlMs ?? TTL_MS;
  }

  async list(query: RegistryListQuery): Promise<RegistryResult<RegistryListBody>> {
    const params = new URLSearchParams({ version: "latest", limit: String(query.limit) });
    if (query.search) params.set("search", query.search);
    if (query.cursor) params.set("cursor", query.cursor);
    const path = `/v0.1/servers?${params.toString()}`;
    return await this.cached(`list:${params.toString()}`, path, RegistryListBody, query.refresh ?? false);
  }

  async get(name: string, refresh = false): Promise<RegistryResult<RegistryEntry>> {
    const path = `/v0.1/servers/${encodeURIComponent(name)}/versions/latest`;
    return await this.cached(`server:${name}`, path, RegistryEntry, refresh);
  }

  private async cached<T extends z.ZodType>(
    key: string,
    path: string,
    schema: T,
    refresh: boolean
  ): Promise<RegistryResult<z.infer<T>>> {
    const now = Date.now();
    const row = this.db.select().from(registryCache).where(eq(registryCache.key, key)).get() ?? null;
    if (!refresh && row && row.expiresAt > now) {
      const stored = decode(schema, row.body);
      if (stored !== null) return { body: stored, fetchedAt: row.fetchedAt, stale: false, error: null };
    }

    try {
      const body = await this.request(path, schema);
      this.store(key, body, now);
      return { body, fetchedAt: now, stale: false, error: null };
    } catch (error) {
      const failure = error instanceof RegistryError ? error : new RegistryError(String(error));
      if (failure.status === 404) throw failure;
      const stored = row ? decode(schema, row.body) : null;
      if (stored !== null) {
        this.logger.warn("registry unreachable, serving a cached copy", { path, error: failure.message });
        return { body: stored, fetchedAt: row?.fetchedAt ?? now, stale: true, error: failure.message };
      }
      throw failure;
    }
  }

  private async request<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { accept: "application/json", "user-agent": `junctio/${VERSION}` },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new RegistryError(timedOut ? `the registry did not answer within ${this.timeoutMs}ms` : message);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new RegistryError(problemMessage(text, response.status), response.status);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new RegistryError("the registry answered with something that is not json");
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new RegistryError("the registry answered in an unexpected shape");
    return parsed.data;
  }

  private store(key: string, body: unknown, now: number): void {
    this.db
      .insert(registryCache)
      .values({ key, body: JSON.stringify(body), fetchedAt: now, expiresAt: now + this.ttlMs })
      .onConflictDoUpdate({
        target: registryCache.key,
        set: { body: JSON.stringify(body), fetchedAt: now, expiresAt: now + this.ttlMs }
      })
      .run();
    this.db.delete(registryCache).where(lt(registryCache.fetchedAt, now - SWEEP_MS)).run();
  }
}

function decode<T extends z.ZodType>(schema: T, body: string): z.infer<T> | null {
  try {
    const parsed = schema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function problemMessage(text: string, status: number): string {
  try {
    const parsed = RegistryProblem.safeParse(JSON.parse(text));
    if (parsed.success) {
      const detail = parsed.data.detail ?? parsed.data.title;
      if (detail) return `the registry answered ${status}: ${detail}`;
    }
  } catch {
    return `the registry answered ${status}`;
  }
  return `the registry answered ${status}`;
}
