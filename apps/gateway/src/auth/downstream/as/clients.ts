import { eq } from "drizzle-orm";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { Db } from "../../../db/index.ts";
import { oauthClients } from "../../../db/schema.ts";
import type { OauthClientRow } from "../../../db/schema.ts";
import type { Cipher } from "../../../crypto.ts";
import { randomToken } from "../../../crypto.ts";

const CLIENT_SECRET_TTL_SEC = 0;

export class SqliteClientsStore implements OAuthRegisteredClientsStore {
  private readonly cache = new Map<string, OAuthClientInformationFull>();

  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher
  ) {}

  invalidate(clientId?: string): void {
    if (clientId) this.cache.delete(clientId);
    else this.cache.clear();
  }

  private async toClient(row: OauthClientRow): Promise<OAuthClientInformationFull> {
    const secret = await this.cipher.decryptNullable(row.clientSecretEnc);
    return {
      ...(row.info as Record<string, unknown>),
      client_id: row.clientId,
      redirect_uris: row.redirectUris,
      ...(secret ? { client_secret: secret, client_secret_expires_at: row.clientSecretExpiresAt ?? 0 } : {})
    } as OAuthClientInformationFull;
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const cached = this.cache.get(clientId);
    if (cached) return cached;
    const row = this.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get();
    if (!row) return undefined;
    const client = await this.toClient(row);
    this.cache.set(clientId, client);
    return client;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): Promise<OAuthClientInformationFull> {
    const clientId = `jnc_${randomToken(24)}`;
    const issuedAt = Math.floor(Date.now() / 1000);
    const isPublic = client.token_endpoint_auth_method === "none";
    const secret = isPublic ? null : (client.client_secret ?? `jns_${randomToken(40)}`);
    const secretExpiresAt = secret ? CLIENT_SECRET_TTL_SEC : null;

    const { client_secret: _ignored, redirect_uris: redirectUris, ...rest } = client;
    const info = { ...rest, client_id: clientId, client_id_issued_at: issuedAt };

    this.db
      .insert(oauthClients)
      .values({
        clientId,
        clientName: client.client_name ?? null,
        clientSecretEnc: secret ? await this.cipher.encrypt(secret) : null,
        clientSecretExpiresAt: secretExpiresAt,
        redirectUris,
        info: info as Record<string, unknown>,
        createdAt: Date.now()
      })
      .run();

    this.invalidate(clientId);
    return {
      ...info,
      redirect_uris: redirectUris,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {})
    } as OAuthClientInformationFull;
  }

  touch(clientId: string): void {
    this.db.update(oauthClients).set({ lastUsedAt: Date.now() }).where(eq(oauthClients.clientId, clientId)).run();
  }

  remove(clientId: string): void {
    this.db.delete(oauthClients).where(eq(oauthClients.clientId, clientId)).run();
    this.invalidate(clientId);
  }
}
