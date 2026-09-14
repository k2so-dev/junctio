import { z } from "zod";

export const ApiKeyInput = z.object({
  name: z.string().min(1).max(64),
  endpointId: z.string().nullable().default(null),
  expiresAt: z.number().int().nullable().default(null)
});
export type ApiKeyInput = z.infer<typeof ApiKeyInput>;

export const ApiKeyDto = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  endpointId: z.string().nullable(),
  endpointSlug: z.string().nullable(),
  expiresAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  createdAt: z.number()
});
export type ApiKeyDto = z.infer<typeof ApiKeyDto>;

export const ApiKeyCreated = ApiKeyDto.extend({ token: z.string() });
export type ApiKeyCreated = z.infer<typeof ApiKeyCreated>;
