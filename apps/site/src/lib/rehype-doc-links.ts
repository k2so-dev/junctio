import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";
import type { VFile } from "vfile";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const DOCS_ROOT = resolve(REPO_ROOT, "docs");
const GITHUB_BLOB = "https://github.com/k2so-dev/junctio/blob/main";

function rewrite(href: string, fromFile: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [pathPart, hash] = href.split("#", 2);
  if (!pathPart?.endsWith(".md")) return href;
  const absolute = resolve(dirname(fromFile), pathPart);
  const suffix = hash ? `#${hash}` : "";
  const insideDocs = relative(DOCS_ROOT, absolute);
  if (!insideDocs.startsWith("..")) {
    const slug = insideDocs.replace(/\\/g, "/").replace(/\.md$/, "");
    return `/docs/${slug}/${suffix}`;
  }
  const insideRepo = relative(REPO_ROOT, absolute).replace(/\\/g, "/");
  return `${GITHUB_BLOB}/${posix.normalize(insideRepo)}${suffix}`;
}

export function rehypeDocLinks() {
  return (tree: Root, file: VFile) => {
    const from = file.path ?? file.history[0];
    if (!from) return;
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href;
      if (typeof href !== "string") return;
      const next = rewrite(href, from);
      node.properties.href = next;
      if (next.startsWith("http")) {
        node.properties.target = "_blank";
        node.properties.rel = ["noreferrer"];
      }
    });
  };
}
