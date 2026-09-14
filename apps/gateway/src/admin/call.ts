import type { Hono } from "hono";
import type { CallToolResult } from "@modelcontextprotocol/server";

export type ApiCall = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export function withQuery(path: string, query: ApiCall["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix === "" ? path : `${path}?${suffix}`;
}

export function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

export function failure(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function describe(status: number, payload: unknown): string {
  const body = payload as { error?: unknown; message?: unknown; details?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message : `the gateway answered ${status}`;
  const error = typeof body?.error === "string" ? body.error : "error";
  const details = Array.isArray(body?.details)
    ? body.details
        .map((issue) => {
          const entry = issue as { path?: unknown; message?: unknown };
          return typeof entry.path === "string" && entry.path !== ""
            ? `${entry.path}: ${String(entry.message)}`
            : String(entry.message);
        })
        .join("; ")
    : "";
  return details === "" ? `${error}: ${message}` : `${error}: ${message} (${details})`;
}

export async function callApi(app: Hono, call: ApiCall): Promise<CallToolResult> {
  const hasBody = call.body !== undefined;
  const response = await app.request(withQuery(call.path, call.query), {
    method: call.method,
    ...(hasBody ? { headers: { "content-type": "application/json" }, body: JSON.stringify(call.body) } : {})
  });

  if (response.status === 204) return text({ ok: true });

  const raw = await response.text();
  let payload: unknown = raw;
  if (raw !== "") {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  if (!response.ok) return failure(describe(response.status, payload));
  return text(payload);
}

export type ReadResult<T> = { ok: true; payload: T } | { ok: false; error: CallToolResult };

export async function readApi<T>(app: Hono, call: ApiCall): Promise<ReadResult<T>> {
  const response = await app.request(withQuery(call.path, call.query), { method: call.method });
  const raw = await response.text();
  let payload: unknown = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }
  if (!response.ok) return { ok: false, error: failure(describe(response.status, payload)) };
  return { ok: true, payload: payload as T };
}
