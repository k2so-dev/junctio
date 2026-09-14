import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { apiKeys } from "../../db/schema.ts";
import type { ApiKeyRow } from "../../db/schema.ts";
import { randomId, randomToken } from "../../crypto.ts";

export const KEY_PREFIX = "jn_";
const SECRET_LENGTH = 40;
const PREFIX_LENGTH = 8;

export type GeneratedKey = {
  token: string;
  prefix: string;
  hash: string;
};

export async function generateApiKey(): Promise<GeneratedKey> {
  const secret = randomToken(SECRET_LENGTH);
  const token = `${KEY_PREFIX}${secret}`;
  const hash = await Bun.password.hash(token, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
  return { token, prefix: secret.slice(0, PREFIX_LENGTH), hash };
}

export function extractKeyPrefix(token: string): string | null {
  if (!token.startsWith(KEY_PREFIX)) return null;
  const secret = token.slice(KEY_PREFIX.length);
  if (secret.length < PREFIX_LENGTH) return null;
  return secret.slice(0, PREFIX_LENGTH);
}

export type VerifyResult = { ok: true; key: ApiKeyRow } | { ok: false; reason: "unknown" | "expired" };

export async function verifyApiKey(db: Db, token: string): Promise<VerifyResult> {
  const prefix = extractKeyPrefix(token);
  if (!prefix) return { ok: false, reason: "unknown" };
  const candidates = db.select().from(apiKeys).where(eq(apiKeys.prefix, prefix)).all();
  for (const candidate of candidates) {
    let matches = false;
    try {
      matches = await Bun.password.verify(token, candidate.hash);
    } catch {
      matches = false;
    }
    if (!matches) continue;
    if (candidate.expiresAt !== null && candidate.expiresAt < Date.now()) return { ok: false, reason: "expired" };
    db.update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, candidate.id)).run();
    return { ok: true, key: candidate };
  }
  return { ok: false, reason: "unknown" };
}

export async function createApiKey(
  db: Db,
  input: { name: string; endpointId: string | null; expiresAt: number | null }
): Promise<{ row: ApiKeyRow; token: string }> {
  const generated = await generateApiKey();
  const row: ApiKeyRow = {
    id: randomId(),
    name: input.name,
    hash: generated.hash,
    prefix: generated.prefix,
    endpointId: input.endpointId,
    expiresAt: input.expiresAt,
    lastUsedAt: null,
    createdAt: Date.now()
  };
  db.insert(apiKeys).values(row).run();
  return { row, token: generated.token };
}

export function readBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKeyHeader = headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader.trim();
  return null;
}
