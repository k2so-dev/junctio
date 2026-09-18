import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { MARKDOWN, docMarkdown } from "@/lib/llms";

export async function getStaticPaths() {
  const entries = await getCollection("docs");
  return entries.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
}

export const GET: APIRoute = ({ props, site }) => new Response(docMarkdown(props.entry, site!), MARKDOWN);
