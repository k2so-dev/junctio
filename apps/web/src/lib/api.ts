import type {
  ApiKeyCreated,
  ApiKeyDto,
  ApiKeyInput,
  ConsentDecisionDto,
  ConsentRequestDto,
  EndpointDto,
  EndpointInput,
  EndpointPatch,
  HealthDto,
  LogLineDto,
  NamespaceDto,
  NamespaceInput,
  NamespacePatch,
  NamespaceServerInput,
  NamespaceToolDto,
  OAuthClientDto,
  RequestLogDto,
  ServerDto,
  ServerInput,
  ServerPatch,
  SessionDto,
  SettingsDto,
  SettingsPatch,
  TestResultDto,
  ToolDto,
  ToolOverrideInput
} from "@junctio/schema";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Body = Record<string, unknown> | unknown[] | undefined;

async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin"
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text === "" ? null : (JSON.parse(text) as unknown);

  if (!response.ok) {
    const shape = payload as { error?: string; message?: string; details?: unknown } | null;
    throw new ApiError(
      response.status,
      shape?.error ?? "error",
      shape?.message ?? response.statusText,
      shape?.details
    );
  }

  return payload as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

export interface ServerCatalog {
  tools: ToolDto[];
  resources: { uri: string; name?: string }[];
  prompts: { name: string; description?: string }[];
  fetchedAt: number;
}

export interface CommandPreview {
  preview: string;
  argv: string[];
}

export interface ValidationResult {
  ok: boolean;
  conflicts: string[];
}

export const api = {
  health: () => fetch("/health").then((r) => r.json() as Promise<HealthDto>),

  session: {
    get: () => request<SessionDto>("GET", "/v1/session"),
    setup: (password: string) => request<{ ok: boolean }>("POST", "/v1/session/setup", { password }),
    login: (password: string) => request<{ ok: boolean }>("POST", "/v1/session/login", { password }),
    logout: () => request<{ ok: boolean }>("POST", "/v1/session/logout", {})
  },

  servers: {
    list: () => request<ServerDto[]>("GET", "/v1/servers"),
    get: (id: string) => request<ServerDto>("GET", `/v1/servers/${id}`),
    create: (input: ServerInput) => request<ServerDto>("POST", "/v1/servers", input),
    patch: (id: string, patch: ServerPatch) => request<ServerDto>("PATCH", `/v1/servers/${id}`, patch),
    remove: (id: string) => request<void>("DELETE", `/v1/servers/${id}`),
    preview: (input: ServerInput) => request<CommandPreview>("POST", "/v1/servers/preview", input),
    start: (id: string) => request<ServerDto>("POST", `/v1/servers/${id}/start`, {}),
    stop: (id: string) => request<ServerDto>("POST", `/v1/servers/${id}/stop`, {}),
    restart: (id: string) => request<ServerDto>("POST", `/v1/servers/${id}/restart`, {}),
    reset: (id: string) => request<ServerDto>("POST", `/v1/servers/${id}/reset`, {}),
    test: (id: string) => request<TestResultDto>("POST", `/v1/servers/${id}/test`, {}),
    tools: (id: string, refresh = false) =>
      request<ServerCatalog>("GET", `/v1/servers/${id}/tools${refresh ? "?refresh=1" : ""}`),
    logs: (id: string, tail = 200) => request<LogLineDto[]>("GET", `/v1/servers/${id}/logs?tail=${tail}`),
    logStream: (id: string, tail = 200) => new EventSource(`/api/v1/servers/${id}/logs?stream=1&tail=${tail}`),
    oauthStart: (id: string) =>
      request<{ authorizationUrl: string }>("POST", `/v1/servers/${id}/oauth/start`, {}),
    oauthRefresh: (id: string) =>
      request<{ refreshed: boolean; oauth: ServerDto["oauth"] }>("POST", `/v1/servers/${id}/oauth/refresh`, {}),
    oauthClear: (id: string) => request<void>("DELETE", `/v1/servers/${id}/oauth`)
  },

  namespaces: {
    list: () => request<NamespaceDto[]>("GET", "/v1/namespaces"),
    get: (id: string) => request<NamespaceDto>("GET", `/v1/namespaces/${id}`),
    create: (input: NamespaceInput) => request<NamespaceDto>("POST", "/v1/namespaces", input),
    patch: (id: string, patch: NamespacePatch) => request<NamespaceDto>("PATCH", `/v1/namespaces/${id}`, patch),
    remove: (id: string) => request<void>("DELETE", `/v1/namespaces/${id}`),
    putServer: (id: string, input: NamespaceServerInput) =>
      request<NamespaceDto>("POST", `/v1/namespaces/${id}/servers`, input),
    removeServer: (id: string, serverId: string) =>
      request<void>("DELETE", `/v1/namespaces/${id}/servers/${serverId}`),
    tools: (id: string) => request<NamespaceToolDto[]>("GET", `/v1/namespaces/${id}/tools`),
    putTool: (id: string, input: ToolOverrideInput) =>
      request<{ ok: boolean }>("PUT", `/v1/namespaces/${id}/tools`, input),
    resetTool: (id: string, serverId: string, toolName: string) =>
      request<void>("DELETE", `/v1/namespaces/${id}/tools/${serverId}/${encodeURIComponent(toolName)}`),
    validate: (id: string) => request<ValidationResult>("POST", `/v1/namespaces/${id}/validate`, {})
  },

  endpoints: {
    list: () => request<EndpointDto[]>("GET", "/v1/endpoints"),
    create: (input: EndpointInput) => request<EndpointDto>("POST", "/v1/endpoints", input),
    patch: (id: string, patch: EndpointPatch) => request<EndpointDto>("PATCH", `/v1/endpoints/${id}`, patch),
    remove: (id: string) => request<void>("DELETE", `/v1/endpoints/${id}`)
  },

  apiKeys: {
    list: () => request<ApiKeyDto[]>("GET", "/v1/api-keys"),
    create: (input: ApiKeyInput) => request<ApiKeyCreated>("POST", "/v1/api-keys", input),
    remove: (id: string) => request<void>("DELETE", `/v1/api-keys/${id}`)
  },

  settings: {
    get: () => request<SettingsDto>("GET", "/v1/settings"),
    patch: (patch: SettingsPatch) => request<{ ok: boolean }>("PATCH", "/v1/settings", patch)
  },

  oauth: {
    request: (id: string) => request<ConsentRequestDto>("GET", `/v1/oauth/requests/${id}`),
    approve: (id: string) => request<ConsentDecisionDto>("POST", `/v1/oauth/requests/${id}/approve`),
    deny: (id: string) => request<ConsentDecisionDto>("POST", `/v1/oauth/requests/${id}/deny`),
    clients: () => request<OAuthClientDto[]>("GET", "/v1/oauth/clients"),
    removeClient: (clientId: string) => request<void>("DELETE", `/v1/oauth/clients/${clientId}`)
  },

  requestLog: (params: { endpointId?: string; serverId?: string; status?: string; limit?: number }) =>
    request<RequestLogDto[]>("GET", `/v1/request-log${query(params)}`)
};
