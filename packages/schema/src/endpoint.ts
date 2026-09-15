import { z } from "zod";

export const endpointAuthModes = ["none", "api_key", "oauth", "any"] as const;
export const EndpointAuthMode = z.enum(endpointAuthModes);
export type EndpointAuthMode = z.infer<typeof EndpointAuthMode>;

export const protocolVersions = ["2025-06-18", "2025-11-25", "2026-07-28"] as const;
export const ProtocolVersion = z.enum(protocolVersions);
export type ProtocolVersion = z.infer<typeof ProtocolVersion>;

export const latestProtocolVersion: ProtocolVersion = protocolVersions[protocolVersions.length - 1]!;

export const RateLimit = z.object({
  perMinute: z.number().int().min(0).max(100000).default(0)
});
export type RateLimit = z.infer<typeof RateLimit>;

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dash only");

export const EndpointInput = z.object({
  slug,
  namespaceId: z.string(),
  authMode: EndpointAuthMode.default("api_key"),
  protocolMin: ProtocolVersion.default(latestProtocolVersion),
  rateLimit: RateLimit.default({ perMinute: 0 }),
  enabled: z.boolean().default(true)
});
export type EndpointInput = z.infer<typeof EndpointInput>;

export const EndpointPatch = z.object({
  slug: slug.optional(),
  namespaceId: z.string().optional(),
  authMode: EndpointAuthMode.optional(),
  protocolMin: ProtocolVersion.optional(),
  rateLimit: RateLimit.optional(),
  enabled: z.boolean().optional()
});
export type EndpointPatch = z.infer<typeof EndpointPatch>;

export const EndpointProtocolUsageDto = z.object({
  protocol: z.string(),
  count: z.number(),
  lastSeenAt: z.number()
});
export type EndpointProtocolUsageDto = z.infer<typeof EndpointProtocolUsageDto>;

export const EndpointDto = z.object({
  id: z.string(),
  slug: z.string(),
  namespaceId: z.string(),
  namespaceName: z.string(),
  authMode: EndpointAuthMode,
  protocolMin: ProtocolVersion,
  rateLimit: RateLimit,
  enabled: z.boolean(),
  createdAt: z.number(),
  url: z.string(),
  keyCount: z.number()
});
export type EndpointDto = z.infer<typeof EndpointDto>;
