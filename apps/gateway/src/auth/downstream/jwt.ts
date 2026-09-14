import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { JwtClaims, JwtVerifier } from "./middleware.ts";

export type IssuerMetadata = {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  grant_types_supported?: string[];
  response_types_supported?: string[];
  code_challenge_methods_supported?: string[];
};

const DISCOVERY_PATHS = ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"];

export async function discoverIssuer(issuer: string, fetchImpl: typeof fetch = fetch): Promise<IssuerMetadata> {
  const base = issuer.replace(/\/+$/, "");
  const errors: string[] = [];
  for (const path of DISCOVERY_PATHS) {
    const url = `${base}${path}`;
    try {
      const response = await fetchImpl(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        errors.push(`${url} returned ${response.status}`);
        continue;
      }
      const metadata = (await response.json()) as IssuerMetadata;
      if (metadata.jwks_uri) return metadata;
      errors.push(`${url} has no jwks_uri`);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`unable to discover authorization server metadata: ${errors.join("; ")}`);
}

function toScopes(payload: JWTPayload): string[] {
  const scope = payload.scope ?? payload.scp;
  if (typeof scope === "string") return scope.split(" ").filter(Boolean);
  if (Array.isArray(scope)) return scope.filter((item): item is string => typeof item === "string");
  return [];
}

export class RemoteJwtVerifier implements JwtVerifier {
  private metadata: Promise<IssuerMetadata> | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    private readonly issuer: string,
    private readonly fixedAudience: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async keys(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (this.jwks) return this.jwks;
    this.metadata ??= discoverIssuer(this.issuer, this.fetchImpl);
    const metadata = await this.metadata;
    this.jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
    return this.jwks;
  }

  async metadataOnce(): Promise<IssuerMetadata> {
    this.metadata ??= discoverIssuer(this.issuer, this.fetchImpl);
    return this.metadata;
  }

  async verify(token: string, audience: string): Promise<JwtClaims> {
    const keys = await this.keys();
    const { payload } = await jwtVerify(token, keys, {
      issuer: this.issuer.replace(/\/+$/, ""),
      audience: this.fixedAudience ?? audience
    });
    return {
      subject: typeof payload.sub === "string" ? payload.sub : "unknown",
      scopes: toScopes(payload),
      clientId: typeof payload.client_id === "string" ? payload.client_id : null
    };
  }
}
