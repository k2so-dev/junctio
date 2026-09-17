import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../docs" }),
  schema: z.object({}).passthrough()
});

const useCases = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/use-cases" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    client: z.string(),
    group: z.enum(["client", "agent"]).default("client"),
    order: z.number(),
    keywords: z.array(z.string()).default([])
  })
});

export const collections = { docs, useCases };
