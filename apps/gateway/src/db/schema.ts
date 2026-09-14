import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;

export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  transport: text("transport", { enum: ["stdio", "http"] }).notNull(),
  runtime: text("runtime", { enum: ["node", "npx", "bunx", "uvx", "uv", "custom"] })
    .notNull()
    .default("custom"),
  command: text("command").notNull().default(""),
  args: text("args", { mode: "json" }).$type<string[]>().notNull().default([]),
  env: text("env", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  cwd: text("cwd"),
  url: text("url"),
  headersEnc: text("headers_enc"),
  authMode: text("auth_mode", { enum: ["none", "header", "oauth"] }).notNull().default("none"),
  oauthScope: text("oauth_scope"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  warm: integer("warm", { mode: "boolean" }).notNull().default(false),
  idleTimeoutSec: integer("idle_timeout_sec").notNull().default(900),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now)
});

export const namespaces = sqliteTable("namespaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: integer("created_at").notNull().default(now)
});

export const namespaceServers = sqliteTable(
  "namespace_servers",
  {
    namespaceId: text("namespace_id")
      .notNull()
      .references(() => namespaces.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true)
  },
  (t) => [primaryKey({ columns: [t.namespaceId, t.serverId] })]
);

export const toolOverrides = sqliteTable(
  "tool_overrides",
  {
    namespaceId: text("namespace_id")
      .notNull()
      .references(() => namespaces.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    displayName: text("display_name"),
    description: text("description"),
    annotations: text("annotations", { mode: "json" }).$type<Record<string, unknown>>()
  },
  (t) => [primaryKey({ columns: [t.namespaceId, t.serverId, t.toolName] })]
);

export const endpoints = sqliteTable("endpoints", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  namespaceId: text("namespace_id")
    .notNull()
    .references(() => namespaces.id, { onDelete: "cascade" }),
  authMode: text("auth_mode", { enum: ["none", "api_key", "oauth", "any"] })
    .notNull()
    .default("api_key"),
  protocolMin: text("protocol_min").notNull().default("2025-06-18"),
  rateLimit: text("rate_limit", { mode: "json" }).$type<{ perMinute: number }>().notNull().default({ perMinute: 0 }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().default(now)
});

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    hash: text("hash").notNull(),
    prefix: text("prefix").notNull(),
    endpointId: text("endpoint_id").references(() => endpoints.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at"),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull().default(now)
  },
  (t) => [index("api_keys_prefix_idx").on(t.prefix)]
);

export const upstreamOauth = sqliteTable("upstream_oauth", {
  serverId: text("server_id")
    .primaryKey()
    .references(() => servers.id, { onDelete: "cascade" }),
  issuer: text("issuer"),
  authorizationServerUrl: text("authorization_server_url"),
  clientId: text("client_id"),
  clientSecretEnc: text("client_secret_enc"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: integer("expires_at"),
  tokenTtlSec: integer("token_ttl_sec"),
  scope: text("scope"),
  resource: text("resource"),
  asMetadata: text("as_metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  status: text("status", { enum: ["ok", "expiring", "needs_reauth", "no_refresh"] })
    .notNull()
    .default("needs_reauth"),
  lastRefreshAt: integer("last_refresh_at"),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull().default(now)
});

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => servers.id, { onDelete: "cascade" }),
  codeVerifier: text("code_verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  resource: text("resource"),
  createdAt: integer("created_at").notNull().default(now)
});

export const oauthClients = sqliteTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name"),
  clientSecretEnc: text("client_secret_enc"),
  clientSecretExpiresAt: integer("client_secret_expires_at"),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  info: text("info", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer("created_at").notNull().default(now),
  lastUsedAt: integer("last_used_at")
});

export const oauthAuthRequests = sqliteTable("oauth_auth_requests", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  state: text("state"),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
  resource: text("resource"),
  createdAt: integer("created_at").notNull().default(now),
  expiresAt: integer("expires_at").notNull()
});

export const oauthAuthCodes = sqliteTable(
  "oauth_auth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
    resource: text("resource"),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull()
  },
  (t) => [index("oauth_auth_codes_client_idx").on(t.clientId)]
);

export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    accessTokenHash: text("access_token_hash").notNull(),
    refreshTokenHash: text("refresh_token_hash"),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
    resource: text("resource"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    lastUsedAt: integer("last_used_at")
  },
  (t) => [
    uniqueIndex("oauth_tokens_access_idx").on(t.accessTokenHash),
    index("oauth_tokens_refresh_idx").on(t.refreshTokenHash)
  ]
);

export const requestLog = sqliteTable(
  "request_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull().default(now),
    endpointId: text("endpoint_id"),
    serverId: text("server_id"),
    method: text("method").notNull(),
    tool: text("tool"),
    durationMs: integer("duration_ms").notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    errorCode: text("error_code")
  },
  (t) => [index("request_log_ts_idx").on(t.ts), index("request_log_endpoint_idx").on(t.endpointId)]
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull()
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull()
  },
  (t) => [uniqueIndex("sessions_id_idx").on(t.id)]
);

export type ServerRow = typeof servers.$inferSelect;
export type NamespaceRow = typeof namespaces.$inferSelect;
export type NamespaceServerRow = typeof namespaceServers.$inferSelect;
export type ToolOverrideRow = typeof toolOverrides.$inferSelect;
export type EndpointRow = typeof endpoints.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type UpstreamOauthRow = typeof upstreamOauth.$inferSelect;
export type OauthClientRow = typeof oauthClients.$inferSelect;
export type OauthAuthRequestRow = typeof oauthAuthRequests.$inferSelect;
export type OauthTokenRow = typeof oauthTokens.$inferSelect;
export type RequestLogRow = typeof requestLog.$inferSelect;
