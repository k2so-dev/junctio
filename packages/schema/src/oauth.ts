import { z } from "zod";

export const ConsentRequestDto = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string().nullable(),
  redirectUri: z.string(),
  scopes: z.array(z.string()),
  resource: z.string().nullable(),
  endpointSlug: z.string().nullable(),
  expiresAt: z.number()
});
export type ConsentRequestDto = z.infer<typeof ConsentRequestDto>;

export const ConsentDecisionDto = z.object({ redirectUrl: z.string() });
export type ConsentDecisionDto = z.infer<typeof ConsentDecisionDto>;

export const OAuthClientDto = z.object({
  clientId: z.string(),
  clientName: z.string().nullable(),
  redirectUris: z.array(z.string()),
  isPublic: z.boolean(),
  tokenCount: z.number(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable()
});
export type OAuthClientDto = z.infer<typeof OAuthClientDto>;
