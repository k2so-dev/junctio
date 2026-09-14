import type { ServerRow } from "../db/schema.ts";

export type ResolvedServer = {
  row: ServerRow;
  headers: Record<string, string>;
};

export interface UpstreamAuth {
  authHeaders(server: ResolvedServer): Promise<Record<string, string>>;
  handleUnauthorized(serverId: string): Promise<boolean>;
}

export const noopUpstreamAuth: UpstreamAuth = {
  authHeaders: async () => ({}),
  handleUnauthorized: async () => false
};

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly serverId: string
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}
