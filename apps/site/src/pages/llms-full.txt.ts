import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { TEXT, demoteHeadings, docMarkdown, llmsHeader } from "@/lib/llms";
import { DOCS_NAV } from "@/lib/site";

export const GET: APIRoute = async ({ site }) => {
  const docs = new Map((await getCollection("docs")).map((entry) => [entry.id, entry]));
  const parts = [llmsHeader().join("\n").trimEnd()];

  for (const item of DOCS_NAV.flatMap((group) => group.items)) {
    const entry = docs.get(item.slug);
    if (entry) parts.push(demoteHeadings(docMarkdown(entry, site!)).trim());
  }

  return new Response(`${parts.join("\n\n")}\n`, TEXT);
};
