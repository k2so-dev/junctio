import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { endpoints } from "../../db/schema.ts";
import type { ApiKeyRow, EndpointRow } from "../../db/schema.ts";
import { getSetting } from "../../db/settings.ts";
import { readBearerToken, verifyApiKey } from "./apikey.ts";

export type JwtClaims = {
  subject: string;
  scopes: string[];
  clientId: string | null;
};

export interface JwtVerifier {
  verify(token: string, audience: string): Promise<JwtClaims>;
}

export type AuthOutcome =
  | { ok: true; via: "none" | "api_key" | "oauth"; key: ApiKeyRow | null; claims: JwtClaims | null }
  | { ok: false; status: 401 | 403; error: string; description: string };

export function endpointBySlug(db: Db, slug: string): EndpointRow | null {
  return db.select().from(endpoints).where(eq(endpoints.slug, slug)).get() ?? null;
}

export function endpointAllowsOauth(endpoint: EndpointRow): boolean {
  return endpoint.authMode === "oauth" || endpoint.authMode === "any";
}

export function endpointAllowsApiKey(endpoint: EndpointRow): boolean {
  return endpoint.authMode === "api_key" || endpoint.authMode === "any";
}

function readToken(request: Request, db: Db): string | null {
  const header = readBearerToken(request.headers);
  if (header) return header;
  if (getSetting(db, "api_key_query_param") !== "true") return null;
  const url = new URL(request.url);
  return url.searchParams.get("api_key") ?? url.searchParams.get("key");
}

export async function authenticateEndpoint(
  db: Db,
  endpoint: EndpointRow,
  request: Request,
  verifier: JwtVerifier | null,
  audience: string
): Promise<AuthOutcome> {
  if (endpoint.authMode === "none") return { ok: true, via: "none", key: null, claims: null };

  const token = readToken(request, db);
  if (!token) {
    return { ok: false, status: 401, error: "invalid_token", description: "missing credentials" };
  }

  if (endpointAllowsApiKey(endpoint)) {
    const result = await verifyApiKey(db, token);
    if (result.ok) {
      if (result.key.endpointId !== null && result.key.endpointId !== endpoint.id) {
        return { ok: false, status: 403, error: "insufficient_scope", description: "key is bound to another endpoint" };
      }
      return { ok: true, via: "api_key", key: result.key, claims: null };
    }
    if (result.reason === "expired") {
      return { ok: false, status: 401, error: "invalid_token", description: "api key expired" };
    }
  }

  if (endpointAllowsOauth(endpoint)) {
    if (!verifier) {
      return { ok: false, status: 401, error: "invalid_token", description: "oauth is not configured" };
    }
    try {
      const claims = await verifier.verify(token, audience);
      return { ok: true, via: "oauth", key: null, claims };
    } catch (error) {
      const description = error instanceof Error ? error.message : "token verification failed";
      return { ok: false, status: 401, error: "invalid_token", description };
    }
  }

  return { ok: false, status: 401, error: "invalid_token", description: "invalid credentials" };
}

export function challengeHeader(
  endpoint: EndpointRow,
  baseUrl: string | null,
  error: string,
  description: string
): string {
  const parts = [`error="${error}"`, `error_description="${description.replaceAll('"', "")}"`];
  if (endpointAllowsOauth(endpoint) && baseUrl) {
    parts.unshift(`resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp/${endpoint.slug}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}
