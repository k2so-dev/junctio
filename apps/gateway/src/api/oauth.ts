import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { ConsentRequestDto, OAuthClientDto } from "@junctio/schema";
import type { Core } from "../core.ts";
import { oauthClients, oauthTokens } from "../db/schema.ts";
import { badRequest, notFound } from "./util.ts";

function slugOf(core: Core, resource: string | null): string | null {
  if (!resource) return null;
  const match = /\/mcp\/([^/?#]+)/.exec(resource);
  return match?.[1] ?? null;
}

export function createOAuthApi(core: Core): Hono {
  const app = new Hono();
  const provider = core.oauthProvider;

  app.get("/requests/:id", (c) => {
    const request = provider.pending(c.req.param("id"));
    if (!request) return notFound(c, "authorization request");
    const dto: ConsentRequestDto = {
      id: request.id,
      clientId: request.clientId,
      clientName: request.clientName,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      resource: request.resource,
      endpointSlug: slugOf(core, request.resource),
      expiresAt: request.expiresAt
    };
    return c.json(dto);
  });

  app.post("/requests/:id/approve", (c) => {
    const redirectUrl = provider.approve(c.req.param("id"));
    if (!redirectUrl) return badRequest(c, "authorization request is unknown or expired");
    core.logger.info("oauth consent granted", { request: c.req.param("id") });
    return c.json({ redirectUrl });
  });

  app.post("/requests/:id/deny", (c) => {
    const redirectUrl = provider.deny(c.req.param("id"));
    if (!redirectUrl) return badRequest(c, "authorization request is unknown or expired");
    return c.json({ redirectUrl });
  });

  app.get("/clients", (c) => {
    const rows = core.db.select().from(oauthClients).all();
    const tokens = core.db.select().from(oauthTokens).all();
    const items: OAuthClientDto[] = rows.map((row) => ({
      clientId: row.clientId,
      clientName: row.clientName,
      redirectUris: row.redirectUris,
      isPublic: row.clientSecretEnc === null,
      tokenCount: tokens.filter((token) => token.clientId === row.clientId).length,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt
    }));
    return c.json(items);
  });

  app.delete("/clients/:clientId", (c) => {
    const clientId = c.req.param("clientId");
    const row = core.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get();
    if (!row) return notFound(c, "client");
    provider.clientsStore.remove(clientId);
    core.logger.info("oauth client revoked", { client: clientId });
    return c.body(null, 204);
  });

  return app;
}
