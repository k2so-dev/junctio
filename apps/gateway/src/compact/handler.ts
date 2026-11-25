import type { CallToolResult } from "@modelcontextprotocol/client";
import type { Core } from "../core.ts";
import type { EndpointRow } from "../db/schema.ts";
import { recordRequest } from "../server/requestlog.ts";
import { UpstreamError } from "../upstream/types.ts";
import { buildCatalog, type Catalog } from "./catalog.ts";
import { EXECUTE_TOOL, SEARCH_TOOL } from "./describe.ts";
import { Attachments, render, sandboxValue, ToolError, TRUNCATION_NOTE } from "./results.ts";
import {
  CALL_GRACE_MS,
  SEARCH_TIMEOUT_MS,
  type SandboxCall,
  type SandboxFailureKind,
  type SandboxOutcome
} from "./sandbox.ts";

export const MAX_CODE_CHARS = 100_000;

const FAILURE_CODES: Record<SandboxFailureKind, string> = {
  code: "code_error",
  timeout: "code_timeout",
  cancelled: "code_cancelled",
  crashed: "sandbox_crashed",
  busy: "sandbox_busy",
  catalog: "catalog_too_large"
};

export type CompactRequest = {
  core: Core;
  endpoint: EndpointRow;
  protocol: string | null;
  signal?: AbortSignal;
};

export function isCompactTool(name: string): name is typeof SEARCH_TOOL | typeof EXECUTE_TOOL {
  return name === SEARCH_TOOL || name === EXECUTE_TOOL;
}

export async function compactCatalog(core: Core, namespaceId: string): Promise<Catalog> {
  const { tools, notes } = await core.aggregator.overview(namespaceId);
  return buildCatalog(tools, notes);
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function callSummary(calls: SandboxCall[]): string | null {
  if (calls.length === 0) return null;
  const failed = calls.filter((call) => !call.ok).length;
  const listed = calls
    .slice(0, 20)
    .map((call) => `${call.name} ${call.ok ? "ok" : "failed"}`)
    .join(", ");
  const more = calls.length > 20 ? `, and ${calls.length - 20} more` : "";
  return `Tool calls before the error: ${calls.length - failed} succeeded, ${failed} failed (${listed}${more}). Calls that succeeded have taken effect.`;
}

function logBlock(logs: string[]): CallToolResult["content"] {
  return logs.length > 0 ? [{ type: "text", text: `Console output:\n${logs.join("\n")}` }] : [];
}

function failureResult(outcome: Extract<SandboxOutcome, { ok: false }>): CallToolResult {
  const where = outcome.error.location ? ` (${outcome.error.location})` : "";
  const lines = [`${outcome.error.name}: ${outcome.error.message}${where}`];
  const summary = callSummary(outcome.calls);
  if (summary) lines.push(summary);
  return { content: [{ type: "text", text: lines.join("\n\n") }, ...logBlock(outcome.logs)], isError: true };
}

function upstreamMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCompactTool(
  request: CompactRequest,
  name: typeof SEARCH_TOOL | typeof EXECUTE_TOOL,
  args: Record<string, unknown> | undefined
): Promise<CallToolResult> {
  const { core, endpoint, protocol } = request;
  const code = args?.code;
  if (typeof code !== "string" || code.trim() === "") {
    return errorResult(`${name} needs a code argument: JavaScript, an async arrow function that returns the result.`);
  }
  if (code.length > MAX_CODE_CHARS) {
    return errorResult(`the code is longer than ${MAX_CODE_CHARS} characters, split the work into several runs`);
  }

  const namespaceId = endpoint.namespaceId;
  const catalog = await compactCatalog(core, namespaceId);
  const attachments = new Attachments();

  const outcome = await core.sandbox.run({
    mode: name,
    code,
    catalog,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(name === SEARCH_TOOL ? { limits: { timeoutMs: SEARCH_TIMEOUT_MS } } : {}),
    call: async (tool, input, context) => {
      const started = Date.now();
      try {
        const { result, serverId } = await core.aggregator.callTool(
          namespaceId,
          tool,
          input as Record<string, unknown>,
          {
            signal: context.signal,
            timeoutMs: Math.max(1, context.deadline - Date.now()) + CALL_GRACE_MS
          }
        );
        recordRequest(core, {
          endpointId: endpoint.id,
          serverId,
          method: "tools/call",
          tool,
          protocol,
          durationMs: Date.now() - started,
          status: result.isError ? "error" : "ok",
          errorCode: result.isError ? "tool_error" : null
        });
        return sandboxValue(result, attachments);
      } catch (error) {
        if (error instanceof ToolError) throw error;
        recordRequest(core, {
          endpointId: endpoint.id,
          serverId: error instanceof UpstreamError ? error.serverId || null : null,
          method: "tools/call",
          tool,
          protocol,
          durationMs: Date.now() - started,
          status: "error",
          errorCode: error instanceof UpstreamError ? error.code : "upstream_error"
        });
        if (error instanceof UpstreamError && error.code === "unknown_tool") {
          throw new TypeError(`no tool named ${JSON.stringify(tool)}, search the catalog for the right name`);
        }
        const failure = new Error(upstreamMessage(error));
        failure.name = "GatewayError";
        throw failure;
      }
    }
  });

  recordRequest(core, {
    endpointId: endpoint.id,
    serverId: null,
    method: "tools/call",
    tool: name,
    protocol,
    durationMs: outcome.durationMs,
    status: outcome.ok ? "ok" : "error",
    errorCode: outcome.ok ? null : FAILURE_CODES[outcome.kind]
  });

  if (!outcome.ok) return failureResult(outcome);
  const { text, truncated } = render(outcome.value);
  return {
    content: [
      { type: "text", text: truncated ? `${text}\n\n${TRUNCATION_NOTE}` : text },
      ...logBlock(outcome.logs),
      ...attachments.referencedBy(outcome.value)
    ]
  };
}
