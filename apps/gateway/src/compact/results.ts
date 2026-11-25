import type { CallToolResult } from "@modelcontextprotocol/client";

type ContentBlock = CallToolResult["content"][number];

export const RESULT_CHARS = 24_000;
const ATTACHMENT_COUNT = 10;
const ATTACHMENT_BYTES = 8 * 1024 * 1024;

export class ToolError extends Error {
  override readonly name = "ToolError";
}

export class Attachments {
  private readonly blocks = new Map<string, ContentBlock>();

  add(block: ContentBlock): string {
    const id = `attachment-${this.blocks.size + 1}`;
    this.blocks.set(id, block);
    return id;
  }

  referencedBy(value: unknown): ContentBlock[] {
    const found: ContentBlock[] = [];
    const seen = new Set<string>();
    let bytes = 0;
    const visit = (node: unknown, depth: number) => {
      if (found.length >= ATTACHMENT_COUNT || depth > 32 || typeof node !== "object" || node === null) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      const record = node as Record<string, unknown>;
      const id = record.attachment;
      if (typeof id === "string" && !seen.has(id)) {
        const block = this.blocks.get(id);
        if (block) {
          seen.add(id);
          const size = blockSize(block);
          if (bytes + size <= ATTACHMENT_BYTES) {
            bytes += size;
            found.push(block);
          }
        }
      }
      for (const child of Object.values(record)) visit(child, depth + 1);
    };
    visit(value, 0);
    return found;
  }
}

function blockSize(block: ContentBlock): number {
  if (block.type === "image" || block.type === "audio") return block.data.length;
  if (block.type === "resource" && "blob" in block.resource) return block.resource.blob.length;
  return 0;
}

function textOf(result: CallToolResult): string {
  return (result.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}

function parseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function placeholder(block: ContentBlock, attachments: Attachments): unknown {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
    case "audio":
      return { type: block.type, mimeType: block.mimeType, attachment: attachments.add(block) };
    case "resource": {
      const { uri, mimeType } = block.resource;
      if ("text" in block.resource) return { type: "resource", uri, mimeType, text: block.resource.text };
      return { type: "resource", uri, mimeType, attachment: attachments.add(block) };
    }
    case "resource_link": {
      const { type, uri, name, title, description, mimeType } = block;
      return { type, uri, name, title, description, mimeType };
    }
    default:
      return block;
  }
}

export function sandboxValue(result: CallToolResult, attachments: Attachments): unknown {
  if (result.isError) throw new ToolError(textOf(result) || "the tool reported an error without a message");
  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent;
  const blocks = result.content ?? [];
  if (blocks.length === 0) return null;
  if (blocks.every((block) => block.type === "text")) return parseText(textOf(result));
  return { content: blocks.map((block) => placeholder(block, attachments)) };
}

function clip(value: unknown, stringCap: number, itemCap: number, depth: number): unknown {
  if (typeof value === "string") {
    return value.length > stringCap
      ? `${value.slice(0, stringCap)}… [truncated, ${value.length - stringCap} more characters]`
      : value;
  }
  if (typeof value !== "object" || value === null) return value;
  if (depth > 24) return "[truncated, nested too deep]";
  if (Array.isArray(value)) {
    const kept = value.slice(0, itemCap).map((item) => clip(item, stringCap, itemCap, depth + 1));
    if (value.length > itemCap) kept.push(`[truncated, ${value.length - itemCap} more items]`);
    return kept;
  }
  const entries = Object.entries(value);
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, itemCap * 4)) out[key] = clip(item, stringCap, itemCap, depth + 1);
  if (entries.length > itemCap * 4) out["[truncated]"] = `${entries.length - itemCap * 4} more keys`;
  return out;
}

const SCHEDULE: [number, number][] = [
  [4000, 200],
  [2000, 100],
  [1000, 50],
  [500, 25],
  [250, 12],
  [120, 6],
  [60, 3]
];

export function render(value: unknown, maxChars = RESULT_CHARS): { text: string; truncated: boolean } {
  if (typeof value === "string") {
    if (value.length <= maxChars) return { text: value, truncated: false };
    return { text: value.slice(0, maxChars), truncated: true };
  }
  const pretty = JSON.stringify(value, null, 2) ?? "null";
  if (pretty.length <= maxChars) return { text: pretty, truncated: false };
  const compact = JSON.stringify(value) ?? "null";
  if (compact.length <= maxChars) return { text: compact, truncated: false };
  for (const [stringCap, itemCap] of SCHEDULE) {
    const text = JSON.stringify(clip(value, stringCap, itemCap, 0)) ?? "null";
    if (text.length <= maxChars) return { text, truncated: true };
  }
  return { text: compact.slice(0, maxChars), truncated: true };
}

export const TRUNCATION_NOTE =
  "[The result was cut to about 6,000 tokens. Return less: pick the fields you need, filter or slice arrays.]";
