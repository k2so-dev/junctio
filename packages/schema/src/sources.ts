import { z } from "zod";

export const sourceGroups = ["canonical", "api", "catalogs", "vendors", "regional"] as const;
export const SourceGroup = z.enum(sourceGroups);
export type SourceGroup = z.infer<typeof SourceGroup>;

export const SourceDto = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dash only"),
  group: SourceGroup,
  name: z.string().min(1).max(60),
  url: z.string().url().startsWith("https://"),
  host: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  api: z.boolean(),
  icon: z.string().nullable()
});
export type SourceDto = z.infer<typeof SourceDto>;

export const SourceCatalog = z.object({
  sources: z.array(SourceDto).min(1)
});
export type SourceCatalog = z.infer<typeof SourceCatalog>;
