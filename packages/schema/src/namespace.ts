import { z } from "zod";

const slugLike = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "letters, digits, dash and underscore only");

export const NamespaceInput = z.object({
  name: slugLike,
  description: z.string().max(500).nullable().default(null)
});
export type NamespaceInput = z.infer<typeof NamespaceInput>;

export const NamespacePatch = z.object({
  name: slugLike.optional(),
  description: z.string().max(500).nullable().optional()
});
export type NamespacePatch = z.infer<typeof NamespacePatch>;

export const NamespaceServerInput = z.object({
  serverId: z.string(),
  prefix: slugLike.nullable().default(null),
  enabled: z.boolean().default(true)
});
export type NamespaceServerInput = z.infer<typeof NamespaceServerInput>;

export const ToolOverrideInput = z.object({
  serverId: z.string(),
  toolName: z.string().min(1),
  enabled: z.boolean().default(true),
  displayName: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  annotations: z.record(z.string(), z.unknown()).nullable().default(null)
});
export type ToolOverrideInput = z.infer<typeof ToolOverrideInput>;

export const NamespaceServerDto = z.object({
  serverId: z.string(),
  serverName: z.string(),
  prefix: z.string(),
  enabled: z.boolean()
});
export type NamespaceServerDto = z.infer<typeof NamespaceServerDto>;

export const NamespaceDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.number(),
  servers: z.array(NamespaceServerDto),
  endpointCount: z.number()
});
export type NamespaceDto = z.infer<typeof NamespaceDto>;

export const NamespaceToolDto = z.object({
  serverId: z.string(),
  serverName: z.string(),
  toolName: z.string(),
  exposedName: z.string(),
  enabled: z.boolean(),
  displayName: z.string().nullable(),
  description: z.string().nullable(),
  originalDescription: z.string().nullable(),
  annotations: z.record(z.string(), z.unknown()).nullable(),
  originalAnnotations: z.record(z.string(), z.unknown()).nullable()
});
export type NamespaceToolDto = z.infer<typeof NamespaceToolDto>;
