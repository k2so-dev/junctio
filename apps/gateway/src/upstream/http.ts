import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "../log.ts";
import type { ResolvedServer, UpstreamAuth } from "./types.ts";

export type HttpTransportOptions = {
  server: ResolvedServer;
  auth: UpstreamAuth;
  logger: Logger;
  onUnauthorized?: () => void;
};

export function createHttpTransport(options: HttpTransportOptions): StreamableHTTPClientTransport {
  const { server, auth, logger } = options;
  const url = new URL(server.row.url ?? "");

  const fetchWithAuth: FetchLike = async (input, init) => {
    const send = async (extra: Record<string, string>) => {
      const headers = new Headers(init?.headers);
      for (const [key, value] of Object.entries(server.headers)) headers.set(key, value);
      for (const [key, value] of Object.entries(extra)) headers.set(key, value);
      return fetch(input as RequestInfo, { ...init, headers });
    };

    const response = await send(await auth.authHeaders(server));
    if (response.status !== 401) return response;

    logger.warn("upstream returned 401, attempting refresh", { server: server.row.id });
    const refreshed = await auth.handleUnauthorized(server.row.id);
    if (!refreshed) {
      options.onUnauthorized?.();
      return response;
    }
    const retried = await send(await auth.authHeaders(server));
    if (retried.status === 401) options.onUnauthorized?.();
    return retried;
  };

  return new StreamableHTTPClientTransport(url, { fetch: fetchWithAuth });
}
