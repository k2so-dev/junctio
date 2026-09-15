import { z } from "zod";

export const HealthDto = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  uptimeSec: z.number(),
  servers: z.object({
    total: z.number(),
    running: z.number(),
    failed: z.number(),
    needsReauth: z.number(),
    quarantined: z.number()
  }),
  audit: z.object({
    enabled: z.boolean(),
    lastRunAt: z.number().nullable(),
    vulnerable: z.number(),
    quarantined: z.number(),
    errors: z.number()
  })
});
export type HealthDto = z.infer<typeof HealthDto>;

export const DockerStatusDto = z.object({
  socket: z.string(),
  available: z.boolean(),
  version: z.string().nullable(),
  apiVersion: z.string().nullable(),
  error: z.string().nullable()
});
export type DockerStatusDto = z.infer<typeof DockerStatusDto>;

export const LogLineDto = z.object({
  ts: z.number(),
  stream: z.enum(["stdout", "stderr", "system"]),
  line: z.string()
});
export type LogLineDto = z.infer<typeof LogLineDto>;

export const RequestLogDto = z.object({
  id: z.number(),
  ts: z.number(),
  endpointId: z.string().nullable(),
  endpointSlug: z.string().nullable(),
  serverId: z.string().nullable(),
  serverName: z.string().nullable(),
  method: z.string(),
  tool: z.string().nullable(),
  protocol: z.string().nullable(),
  durationMs: z.number(),
  status: z.enum(["ok", "error"]),
  errorCode: z.string().nullable()
});
export type RequestLogDto = z.infer<typeof RequestLogDto>;

export const RequestLogQuery = z.object({
  endpointId: z.string().optional(),
  serverId: z.string().optional(),
  status: z.enum(["ok", "error"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().optional()
});
export type RequestLogQuery = z.infer<typeof RequestLogQuery>;

export const TestResultDto = z.object({
  ok: z.boolean(),
  durationMs: z.number(),
  serverInfo: z.object({ name: z.string(), version: z.string() }).nullable(),
  protocolVersion: z.string().nullable(),
  toolCount: z.number().nullable(),
  error: z.string().nullable()
});
export type TestResultDto = z.infer<typeof TestResultDto>;

export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional()
});
export type ApiError = z.infer<typeof ApiError>;
