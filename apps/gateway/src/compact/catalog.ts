import type { Tool } from "@modelcontextprotocol/client";
import type { AggregatedTool, ServerNote } from "../aggregate/aggregator.ts";
import { toolSignature } from "./signature.ts";

export type CatalogTool = {
  name: string;
  server: string;
  title?: string;
  description: string;
  annotations?: Tool["annotations"];
  inputSchema: Tool["inputSchema"];
  outputSchema?: Tool["outputSchema"];
  signature: string;
};

export type CatalogServer = {
  name: string;
  summary: string | null;
  instructions: string | null;
  tools: number;
  quarantined: boolean;
};

export type Catalog = {
  tools: CatalogTool[];
  servers: CatalogServer[];
};

const SUMMARY_LIMIT = 160;

export function searchWords(text: string | undefined): string {
  const tokens = String(text ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  return [...new Set(tokens)].join(" ");
}

export function catalogPayload(catalog: Catalog): string {
  const words = catalog.tools.map((tool) => [tool.name, tool.title, tool.server, tool.description].map(searchWords));
  return JSON.stringify({ ...catalog, words });
}

export function summarize(text: string | null | undefined): string | null {
  const paragraph = text
    ?.split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s.*$/gm, "").trim())
    .find((part) => part !== "");
  if (!paragraph) return null;
  const line = paragraph.replace(/\s+/g, " ");
  if (line.length <= SUMMARY_LIMIT) return line;
  const sentence = line.slice(0, SUMMARY_LIMIT).match(/^.*[.!?](?=\s)/)?.[0];
  return sentence ?? `${line.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`;
}

export function buildCatalog(tools: AggregatedTool[], notes: ServerNote[]): Catalog {
  const prefixes = new Map(notes.map((note) => [note.serverId, note.prefix]));
  const counts = new Map<string, number>();
  const entries: CatalogTool[] = tools.map(({ tool, serverId }) => {
    const server = prefixes.get(serverId) ?? "";
    counts.set(server, (counts.get(server) ?? 0) + 1);
    return {
      name: tool.name,
      server,
      ...(tool.title ? { title: tool.title } : {}),
      description: tool.description ?? "",
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      signature: toolSignature(tool)
    };
  });
  const servers: CatalogServer[] = notes.map((note) => ({
    name: note.prefix,
    summary: note.quarantined ? null : summarize(note.text),
    instructions: note.quarantined ? null : (note.text?.trim() ?? null) || null,
    tools: counts.get(note.prefix) ?? 0,
    quarantined: note.quarantined
  }));
  return { tools: entries, servers };
}

export type ExecuteHints = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export function executeHints(tools: CatalogTool[]): ExecuteHints {
  const readOnly = tools.length > 0 && tools.every((tool) => tool.annotations?.readOnlyHint === true);
  const destructive = tools.some(
    (tool) => tool.annotations?.readOnlyHint !== true && tool.annotations?.destructiveHint !== false
  );
  const openWorld = tools.some((tool) => tool.annotations?.openWorldHint !== false);
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && destructive,
    idempotentHint: false,
    openWorldHint: openWorld
  };
}
