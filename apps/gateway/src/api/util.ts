import type { Context } from "hono";
import type { ZodError } from "zod";

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

export function badRequest(c: Context, error: ZodError | string) {
  if (typeof error === "string") {
    return c.json({ error: "bad_request", message: error }, 400);
  }
  return c.json(
    {
      error: "validation_failed",
      message: "request body is invalid",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    },
    400
  );
}

export function notFound(c: Context, what: string) {
  return c.json({ error: "not_found", message: `${what} not found` }, 404);
}

export function conflict(c: Context, message: string) {
  return c.json({ error: "conflict", message }, 409);
}

export function forbidden(c: Context, message: string) {
  return c.json({ error: "forbidden", message }, 403);
}
