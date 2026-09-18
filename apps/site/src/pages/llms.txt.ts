import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { TEXT, docSummary, firstSentence, llmsHeader } from "@/lib/llms";
import { DOCS_NAV, SITE } from "@/lib/site";

export const GET: APIRoute = async ({ site }) => {
  const docs = new Map((await getCollection("docs")).map((entry) => [entry.id, entry]));
  const useCases = (await getCollection("useCases")).sort((a, b) => a.data.order - b.data.order);
  const url = (path: string) => new URL(path, site).href;
  const lines = llmsHeader();

  for (const group of DOCS_NAV) {
    lines.push(`## ${group.label}`, "");
    for (const item of group.items) {
      const entry = docs.get(item.slug);
      if (!entry) {
        lines.push(`- [${item.title}](${url("/docs/")}): ${SITE.gettingStarted}`);
        continue;
      }
      lines.push(`- [${item.title}](${url(`/docs/${item.slug}.md`)}): ${firstSentence(docSummary(entry))}`);
    }
    lines.push("");
  }

  lines.push("## Use cases", "");
  for (const entry of useCases) {
    lines.push(`- [${entry.data.title}](${url(`/use-cases/${entry.id}/`)}): ${entry.data.description}`);
  }

  lines.push(
    "",
    "## Optional",
    "",
    `- [Full documentation](${url("/llms-full.txt")}): every docs page in one file`,
    `- [Source](${SITE.repo})`,
    `- [Container image](${SITE.repo}/pkgs/container/junctio): ${SITE.image}, latest is the last release, edge follows main`,
    ""
  );

  return new Response(lines.join("\n"), TEXT);
};
