import { z } from "zod";

export const SettingsDto = z.object({
  baseUrl: z.string(),
  toolSeparator: z.string(),
  runtimePath: z.string(),
  apiKeyQueryParam: z.boolean(),
  requestLogRetentionDays: z.number(),
  oauthIssuer: z.string().nullable(),
  version: z.string()
});
export type SettingsDto = z.infer<typeof SettingsDto>;

export const SettingsPatch = z.object({
  toolSeparator: z.string().min(1).max(8).regex(/^[^a-zA-Z0-9\s]+$|^_+$/u, "use non-alphanumeric separator").optional(),
  runtimePath: z.string().min(1).optional(),
  apiKeyQueryParam: z.boolean().optional(),
  requestLogRetentionDays: z.number().int().min(1).max(365).optional()
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const LoginInput = z.object({ password: z.string().min(1) });
export type LoginInput = z.infer<typeof LoginInput>;

export const SetupInput = z.object({ password: z.string().min(8).max(256) });
export type SetupInput = z.infer<typeof SetupInput>;

export const SessionDto = z.object({
  authenticated: z.boolean(),
  needsSetup: z.boolean()
});
export type SessionDto = z.infer<typeof SessionDto>;
