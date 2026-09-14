import { z } from "zod";
import { ServerInput } from "./server.ts";

export const registryPackageKinds = ["npm", "pypi", "remote", "other"] as const;
export const RegistryPackageKind = z.enum(registryPackageKinds);
export type RegistryPackageKind = z.infer<typeof RegistryPackageKind>;

export const RegistryQuery = z.object({
  search: z.string().max(200).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  refresh: z.coerce.boolean().default(false)
});
export type RegistryQuery = z.infer<typeof RegistryQuery>;

export const RegistryDetailQuery = z.object({
  name: z.string().min(1).max(200),
  refresh: z.coerce.boolean().default(false)
});
export type RegistryDetailQuery = z.infer<typeof RegistryDetailQuery>;

export const RegistryServerDto = z.object({
  name: z.string(),
  title: z.string().nullable(),
  description: z.string(),
  version: z.string(),
  repositoryUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  publishedAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  status: z.string(),
  kinds: z.array(RegistryPackageKind),
  installable: z.boolean(),
  installed: z.boolean()
});
export type RegistryServerDto = z.infer<typeof RegistryServerDto>;

export const RegistryInputDto = z.object({
  name: z.string(),
  description: z.string().nullable(),
  required: z.boolean(),
  secret: z.boolean()
});
export type RegistryInputDto = z.infer<typeof RegistryInputDto>;

export const RegistryInstallOptionDto = z.object({
  id: z.string(),
  kind: RegistryPackageKind,
  label: z.string(),
  detail: z.string(),
  supported: z.boolean(),
  reason: z.string().nullable(),
  draft: ServerInput.nullable(),
  inputs: z.array(RegistryInputDto)
});
export type RegistryInstallOptionDto = z.infer<typeof RegistryInstallOptionDto>;

export const RegistryListDto = z.object({
  items: z.array(RegistryServerDto),
  nextCursor: z.string().nullable(),
  fetchedAt: z.number(),
  stale: z.boolean(),
  error: z.string().nullable()
});
export type RegistryListDto = z.infer<typeof RegistryListDto>;

export const RegistryDetailDto = z.object({
  server: RegistryServerDto,
  options: z.array(RegistryInstallOptionDto),
  fetchedAt: z.number(),
  stale: z.boolean(),
  error: z.string().nullable()
});
export type RegistryDetailDto = z.infer<typeof RegistryDetailDto>;
