import { resolve } from "node:path";
import type { CollectionEntry } from "astro:content";
import { DOCS_ROOT, rewriteDocLink } from "./rehype-doc-links";
import { SITE } from "./site";

type Doc = CollectionEntry<"docs">;

export function docSummary(entry: Doc): string {
  return (
    entry.body
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith("```"))
      ?.replace(/[*`[\]]/g, "") ?? SITE.description
  );
}

export function firstSentence(text: string): string {
  return text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
}

export function docMarkdown(entry: Doc, site: URL): string {
  const from = resolve(DOCS_ROOT, `${entry.id}.md`);
  return (entry.body ?? "").replace(/\]\(([^)\s]+)\)/g, (_, href: string) => {
    const next = rewriteDocLink(href, from);
    return `](${next.startsWith("/") ? new URL(next, site).href : next})`;
  });
}

export function demoteHeadings(markdown: string): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
    })
    .join("\n");
}

export function llmsHeader(): string[] {
  return [`# ${SITE.name}`, "", `> ${SITE.tagline}. ${SITE.description}`, ""];
}

export const TEXT = { headers: { "Content-Type": "text/plain; charset=utf-8" } };
export const MARKDOWN = { headers: { "Content-Type": "text/markdown; charset=utf-8" } };
