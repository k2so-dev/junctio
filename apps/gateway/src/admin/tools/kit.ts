import type { Hono } from "hono";
import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Core } from "../../core.ts";
import { recordRequest } from "../../server/requestlog.ts";
import { failure } from "../call.ts";

export type AdminApis = {
  servers: Hono;
  namespaces: Hono;
  endpoints: Hono;
  apiKeys: Hono;
  oauth: Hono;
  registry: Hono;
  settings: Hono;
  requestLog: Hono;
  audit: Hono;
};

export type AdminDeps = {
  core: Core;
  apis: AdminApis;
};

export function resourceId(label: string) {
  return z.uuid().describe(label);
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const MUTATES: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
export const UPDATES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
export const DESTROYS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

export type ToolConfig<T extends z.ZodType> = {
  title: string;
  description: string;
  inputSchema?: T;
  annotations: ToolAnnotations;
};

export function defineTool<T extends z.ZodType>(
  server: McpServer,
  deps: AdminDeps,
  name: string,
  config: ToolConfig<T>,
  handler: (input: z.infer<T>) => Promise<CallToolResult>
): void {
  const run = async (input: z.infer<T>): Promise<CallToolResult> => {
    const started = Date.now();
    try {
      const result = await handler(input);
      recordRequest(deps.core, {
        endpointId: null,
        serverId: null,
        method: "tools/call",
        tool: name,
        protocol: null,
        durationMs: Date.now() - started,
        status: result.isError ? "error" : "ok",
        errorCode: result.isError ? "tool_error" : null
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordRequest(deps.core, {
        endpointId: null,
        serverId: null,
        method: "tools/call",
        tool: name,
        protocol: null,
        durationMs: Date.now() - started,
        status: "error",
        errorCode: "tool_error"
      });
      deps.core.logger.error("admin tool failed", { tool: name, error: message });
      return failure(message);
    }
  };

  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      annotations: config.annotations,
      ...(config.inputSchema ? { inputSchema: config.inputSchema } : {})
    },
    run as never
  );
}
