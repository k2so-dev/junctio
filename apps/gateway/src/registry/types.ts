import { z } from "zod";

export const REGISTRY_URL = "https://registry.modelcontextprotocol.io";

const RegistryArgument = z.looseObject({
  type: z.string().optional(),
  name: z.string().optional(),
  format: z.string().optional(),
  value: z.string().optional(),
  default: z.string().optional(),
  valueHint: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  isRepeated: z.boolean().optional(),
  description: z.string().optional()
});
export type RegistryArgument = z.infer<typeof RegistryArgument>;

const RegistryKeyValue = z.looseObject({
  name: z.string().optional(),
  value: z.string().optional(),
  default: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  description: z.string().optional()
});
export type RegistryKeyValue = z.infer<typeof RegistryKeyValue>;

const RegistryTransport = z.looseObject({
  type: z.string().optional(),
  url: z.string().optional(),
  headers: z.array(RegistryKeyValue).optional()
});
export type RegistryTransport = z.infer<typeof RegistryTransport>;

const RegistryPackage = z.looseObject({
  registryType: z.string().optional(),
  registryBaseUrl: z.string().optional(),
  identifier: z.string().optional(),
  version: z.string().optional(),
  runtimeHint: z.string().optional(),
  transport: RegistryTransport.optional(),
  runtimeArguments: z.array(RegistryArgument).optional(),
  packageArguments: z.array(RegistryArgument).optional(),
  environmentVariables: z.array(RegistryKeyValue).optional()
});
export type RegistryPackage = z.infer<typeof RegistryPackage>;

const RegistryOfficialMeta = z.looseObject({
  status: z.string().optional(),
  isLatest: z.boolean().optional(),
  publishedAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const RegistryServer = z.looseObject({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  websiteUrl: z.string().optional(),
  repository: z.looseObject({ url: z.string().optional(), source: z.string().optional() }).optional(),
  packages: z.array(RegistryPackage).optional(),
  remotes: z.array(RegistryTransport).optional()
});
export type RegistryServer = z.infer<typeof RegistryServer>;

export const RegistryEntry = z.looseObject({
  server: RegistryServer,
  _meta: z
    .looseObject({ "io.modelcontextprotocol.registry/official": RegistryOfficialMeta.optional() })
    .optional()
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;

export const RegistryListBody = z.looseObject({
  servers: z.array(z.unknown()).default([]),
  metadata: z.looseObject({ count: z.number().optional(), nextCursor: z.string().optional() }).optional()
});
export type RegistryListBody = z.infer<typeof RegistryListBody>;

export const RegistryProblem = z.looseObject({
  title: z.string().optional(),
  detail: z.string().optional(),
  status: z.number().optional()
});

export function registryEntries(body: RegistryListBody): RegistryEntry[] {
  const out: RegistryEntry[] = [];
  for (const item of body.servers) {
    const parsed = RegistryEntry.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function officialMeta(entry: RegistryEntry): z.infer<typeof RegistryOfficialMeta> {
  return entry._meta?.["io.modelcontextprotocol.registry/official"] ?? {};
}
