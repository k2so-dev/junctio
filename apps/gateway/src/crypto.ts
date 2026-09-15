import { scryptSync } from "node:crypto";

const ALGO = "AES-GCM";
const IV_BYTES = 12;
const PREFIX = "v2.";
const SALT_BYTES = 32;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function newCipherSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = scryptSync(secret, salt, 32, SCRYPT);
  return crypto.subtle.importKey("raw", material, ALGO, false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: ALGO, iv }, key, data));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return `${PREFIX}${Buffer.from(out).toString("base64")}`;
}

export async function decrypt(payload: string, key: CryptoKey): Promise<string> {
  if (!payload.startsWith(PREFIX)) throw new Error("unsupported ciphertext format");
  const raw = Buffer.from(payload.slice(PREFIX.length), "base64");
  if (raw.length <= IV_BYTES) throw new Error("malformed ciphertext");
  const iv = raw.subarray(0, IV_BYTES);
  const cipher = raw.subarray(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export function createCipher(secret: string, salt: Uint8Array) {
  const key = deriveKey(secret, salt);
  return {
    encrypt: async (value: string) => encrypt(value, await key),
    decrypt: async (value: string) => decrypt(value, await key),
    encryptNullable: async (value: string | null | undefined) =>
      value === null || value === undefined ? null : await encrypt(value, await key),
    decryptNullable: async (value: string | null | undefined) =>
      value === null || value === undefined ? null : await decrypt(value, await key)
  };
}

export type Cipher = ReturnType<typeof createCipher>;

export function randomId(): string {
  return crypto.randomUUID();
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);

export function randomToken(length = 32): string {
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length - out.length))) {
      if (b < UNBIASED_LIMIT) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

export function sha256Hex(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] as number) ^ (bb[i] as number);
  return diff === 0;
}
