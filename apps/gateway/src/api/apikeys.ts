import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { ApiKeyInput } from "@junctio/schema";
import type { Core } from "../core.ts";
import { apiKeys, endpoints } from "../db/schema.ts";
import { createApiKey } from "../auth/downstream/apikey.ts";
import { toApiKeyDto } from "./dto.ts";
import { badRequest, notFound, readJson } from "./util.ts";

export function createApiKeysApi(core: Core): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const rows = core.db.select().from(apiKeys).all();
    return c.json(rows.map((row) => toApiKeyDto(core, row)));
  });

  app.post("/", async (c) => {
    const parsed = ApiKeyInput.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const input = parsed.data;
    if (input.endpointId && !core.db.select().from(endpoints).where(eq(endpoints.id, input.endpointId)).get()) {
      return notFound(c, "endpoint");
    }
    const { row, token } = await createApiKey(core.db, input);
    return c.json({ ...toApiKeyDto(core, row), token }, 201);
  });

  app.delete("/:id", (c) => {
    const row = core.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, c.req.param("id")))
      .get();
    if (!row) return notFound(c, "api key");
    core.db.delete(apiKeys).where(eq(apiKeys.id, row.id)).run();
    return c.body(null, 204);
  });

  return app;
}
