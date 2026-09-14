import { eq } from "drizzle-orm";
import type {
  ApiKeyDto,
  EndpointDto,
  NamespaceDto,
  ServerDto,
  ServerOAuthInfo,
  ServerStatus
} from "@junctio/schema";
import type { ApiKeyRow, EndpointRow, NamespaceRow, ServerRow } from "../db/schema.ts";
import { apiKeys, endpoints, namespaceServers, namespaces, servers } from "../db/schema.ts";
import type { Core } from "../core.ts";

export const MASKED = "***";

export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(headers)) out[key] = MASKED;
  return out;
}

export function mergeHeaders(
  incoming: Record<string, string> | undefined,
  stored: Record<string, string>
): Record<string, string> | undefined {
  if (!incoming) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    out[key] = value === MASKED ? (stored[key] ?? "") : value;
  }
  return out;
}

export function serverStatus(core: Core, row: ServerRow, oauth: ServerOAuthInfo | null): ServerStatus {
  if (!row.enabled) return "stopped";
  if (oauth && (oauth.status === "needs_reauth" || oauth.status === "no_refresh")) return oauth.status;
  if (row.transport === "http") return core.pool.cachedCatalog(row.id) ? "running" : "stopped";
  return core.supervisor.getInfo(row.id).state;
}

export async function readOauthInfo(core: Core, row: ServerRow): Promise<ServerOAuthInfo | null> {
  if (row.authMode !== "oauth") return null;
  const state = await core.upstreamAuth.store.read(row.id);
  if (!state) {
    return { status: "needs_reauth", expiresAt: null, hasRefreshToken: false, scope: null, lastRefreshAt: null, lastError: null };
  }
  return {
    status: state.status,
    expiresAt: state.tokens?.expiresAt ?? null,
    hasRefreshToken: Boolean(state.tokens?.refreshToken),
    scope: state.tokens?.scope ?? null,
    lastRefreshAt: state.lastRefreshAt,
    lastError: state.lastError
  };
}

export async function toServerDto(core: Core, row: ServerRow): Promise<ServerDto> {
  const oauth = await readOauthInfo(core, row);
  const info = core.supervisor.getInfo(row.id);
  const resolved = await core.registry.resolve(row.id);
  const catalog = core.pool.cachedCatalog(row.id);
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    runtime: row.runtime,
    command: row.command,
    args: row.args,
    env: row.env,
    cwd: row.cwd,
    url: row.url,
    headers: maskHeaders(resolved?.headers ?? {}),
    authMode: row.authMode,
    oauthScope: row.oauthScope,
    enabled: row.enabled,
    warm: row.warm,
    idleTimeoutSec: row.idleTimeoutSec,
    createdAt: row.createdAt,
    status: serverStatus(core, row, oauth),
    pid: info.pid,
    restarts: info.restarts,
    lastError: info.lastError ?? core.pool.getLastError(row.id),
    toolCount: catalog ? catalog.tools.length : null,
    commandPreview: core.registry.preview(row),
    oauth
  };
}

export function toNamespaceDto(core: Core, row: NamespaceRow): NamespaceDto {
  const members = core.db
    .select({
      serverId: servers.id,
      serverName: servers.name,
      prefix: namespaceServers.prefix,
      enabled: namespaceServers.enabled
    })
    .from(namespaceServers)
    .innerJoin(servers, eq(servers.id, namespaceServers.serverId))
    .where(eq(namespaceServers.namespaceId, row.id))
    .all();
  const endpointCount = core.db.select().from(endpoints).where(eq(endpoints.namespaceId, row.id)).all().length;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    servers: members.map((member) => ({
      serverId: member.serverId,
      serverName: member.serverName,
      prefix: member.prefix ?? member.serverName,
      enabled: member.enabled
    })),
    endpointCount
  };
}

export function endpointUrl(core: Core, slug: string): string {
  return `${core.config.baseUrl ?? `http://localhost:${core.config.port}`}/mcp/${slug}`;
}

export function toEndpointDto(core: Core, row: EndpointRow): EndpointDto {
  const namespace = core.db.select().from(namespaces).where(eq(namespaces.id, row.namespaceId)).get();
  const keyCount = core.db.select().from(apiKeys).where(eq(apiKeys.endpointId, row.id)).all().length;
  return {
    id: row.id,
    slug: row.slug,
    namespaceId: row.namespaceId,
    namespaceName: namespace?.name ?? "",
    authMode: row.authMode,
    protocolMin: row.protocolMin as EndpointDto["protocolMin"],
    rateLimit: row.rateLimit,
    enabled: row.enabled,
    createdAt: row.createdAt,
    url: endpointUrl(core, row.slug),
    keyCount
  };
}

export function toApiKeyDto(core: Core, row: ApiKeyRow): ApiKeyDto {
  const endpoint = row.endpointId
    ? core.db.select().from(endpoints).where(eq(endpoints.id, row.endpointId)).get()
    : null;
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    endpointId: row.endpointId,
    endpointSlug: endpoint?.slug ?? null,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt
  };
}
