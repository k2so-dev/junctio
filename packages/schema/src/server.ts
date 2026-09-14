import { z } from "zod";
import { parseDockerRun } from "./dockerargs.ts";

export const runtimeKinds = ["node", "npx", "bunx", "uvx", "uv", "docker", "custom"] as const;
export const RuntimeKind = z.enum(runtimeKinds);
export type RuntimeKind = z.infer<typeof RuntimeKind>;

export const transportKinds = ["stdio", "http", "sse"] as const;
export const TransportKind = z.enum(transportKinds);
export type TransportKind = z.infer<typeof TransportKind>;

export const authModes = ["none", "header", "oauth"] as const;
export const UpstreamAuthMode = z.enum(authModes);
export type UpstreamAuthMode = z.infer<typeof UpstreamAuthMode>;

export const serverStatuses = [
  "stopped",
  "starting",
  "running",
  "idle",
  "failed",
  "needs_reauth",
  "no_refresh"
] as const;
export const ServerStatus = z.enum(serverStatuses);
export type ServerStatus = z.infer<typeof ServerStatus>;

const name = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "letters, digits, dash and underscore only");

export const ServerInput = z
  .object({
    name,
    transport: TransportKind,
    runtime: RuntimeKind.default("custom"),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    cwd: z.string().nullable().default(null),
    url: z.string().url().nullable().default(null),
    headers: z.record(z.string(), z.string()).default({}),
    authMode: UpstreamAuthMode.default("none"),
    oauthScope: z.string().nullable().default(null),
    enabled: z.boolean().default(true),
    warm: z.boolean().default(false),
    idleTimeoutSec: z.number().int().min(0).max(86400).default(900)
  })
  .superRefine((v, ctx) => {
    if (v.transport === "stdio") {
      if (v.args.every((part) => part.trim() === "")) {
        ctx.addIssue({ code: "custom", path: ["args"], message: "arguments are required for stdio" });
      } else if (v.runtime === "docker") {
        for (const message of parseDockerRun(v.args, v.env).errors) {
          ctx.addIssue({ code: "custom", path: ["args"], message });
        }
      }
      if (v.authMode !== "none") {
        ctx.addIssue({ code: "custom", path: ["authMode"], message: "stdio supports auth mode none only" });
      }
    } else {
      if (!v.url) ctx.addIssue({ code: "custom", path: ["url"], message: "url is required for http and sse" });
    }
  });
export type ServerInput = z.infer<typeof ServerInput>;

export const ServerPatch = z.object({
  name: name.optional(),
  transport: TransportKind.optional(),
  runtime: RuntimeKind.optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  authMode: UpstreamAuthMode.optional(),
  oauthScope: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  warm: z.boolean().optional(),
  idleTimeoutSec: z.number().int().min(0).max(86400).optional()
});
export type ServerPatch = z.infer<typeof ServerPatch>;

export const OAuthStatus = z.enum(["ok", "expiring", "needs_reauth", "no_refresh"]);
export type OAuthStatus = z.infer<typeof OAuthStatus>;

export const ServerOAuthInfo = z.object({
  status: OAuthStatus,
  expiresAt: z.number().nullable(),
  hasRefreshToken: z.boolean(),
  scope: z.string().nullable(),
  lastRefreshAt: z.number().nullable(),
  lastError: z.string().nullable()
});
export type ServerOAuthInfo = z.infer<typeof ServerOAuthInfo>;

export const ServerDto = z.object({
  id: z.string(),
  name: z.string(),
  transport: TransportKind,
  runtime: RuntimeKind,
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  cwd: z.string().nullable(),
  url: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
  authMode: UpstreamAuthMode,
  oauthScope: z.string().nullable(),
  enabled: z.boolean(),
  warm: z.boolean(),
  idleTimeoutSec: z.number(),
  createdAt: z.number(),
  status: ServerStatus,
  pid: z.number().nullable(),
  containerId: z.string().nullable(),
  restarts: z.number(),
  lastError: z.string().nullable(),
  toolCount: z.number().nullable(),
  protocolVersion: z.string().nullable(),
  commandPreview: z.string(),
  oauth: ServerOAuthInfo.nullable()
});
export type ServerDto = z.infer<typeof ServerDto>;

export const ToolDto = z.object({
  name: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  inputSchema: z.unknown(),
  annotations: z.record(z.string(), z.unknown()).nullable()
});
export type ToolDto = z.infer<typeof ToolDto>;
