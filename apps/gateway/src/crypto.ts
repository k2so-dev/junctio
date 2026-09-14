const ALGO = "AES-GCM";
const IV_BYTES = 12;

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const promise = (async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return crypto.subtle.importKey("raw", digest, ALGO, false, ["encrypt", "decrypt"]);
  })();
  keyCache.set(secret, promise);
  return promise;
}

export async function encrypt(plaintext: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: ALGO, iv }, key, data));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return `v1.${Buffer.from(out).toString("base64")}`;
}

export async function decrypt(payload: string, secret: string): Promise<string> {
  if (!payload.startsWith("v1.")) throw new Error("unsupported ciphertext format");
  const raw = Buffer.from(payload.slice(3), "base64");
  if (raw.length <= IV_BYTES) throw new Error("malformed ciphertext");
  const key = await deriveKey(secret);
  const iv = raw.subarray(0, IV_BYTES);
  const cipher = raw.subarray(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export function createCipher(secret: string) {
  return {
    encrypt: (value: string) => encrypt(value, secret),
    decrypt: (value: string) => decrypt(value, secret),
    encryptNullable: async (value: string | null | undefined) =>
      value === null || value === undefined ? null : await encrypt(value, secret),
    decryptNullable: async (value: string | null | undefined) =>
      value === null || value === undefined ? null : await decrypt(value, secret)
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

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] as number) ^ (bb[i] as number);
  return diff === 0;
}
