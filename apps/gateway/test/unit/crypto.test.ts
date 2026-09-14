import { describe, expect, test } from "bun:test";
import { createCipher, decrypt, encrypt, randomToken, timingSafeEqual } from "../../src/crypto.ts";

describe("crypto", () => {
  test("roundtrips a value", async () => {
    const secret = "a".repeat(32);
    const cipher = await encrypt("hello world", secret);
    expect(cipher.startsWith("v1.")).toBe(true);
    expect(await decrypt(cipher, secret)).toBe("hello world");
  });

  test("produces a different ciphertext each time", async () => {
    const secret = "a".repeat(32);
    expect(await encrypt("same", secret)).not.toBe(await encrypt("same", secret));
  });

  test("fails with a wrong secret", async () => {
    const cipher = await encrypt("secret payload", "a".repeat(32));
    await expect(decrypt(cipher, "b".repeat(32))).rejects.toThrow();
  });

  test("rejects an unknown format", async () => {
    await expect(decrypt("v2.abc", "a".repeat(32))).rejects.toThrow("unsupported ciphertext format");
  });

  test("cipher helper handles null", async () => {
    const cipher = createCipher("a".repeat(32));
    expect(await cipher.encryptNullable(null)).toBeNull();
    expect(await cipher.decryptNullable(null)).toBeNull();
    const enc = await cipher.encryptNullable("x");
    expect(await cipher.decryptNullable(enc)).toBe("x");
  });

  test("random token has requested length and alphabet", () => {
    const token = randomToken(40);
    expect(token).toHaveLength(40);
    expect(/^[A-Za-z0-9]+$/.test(token)).toBe(true);
  });

  test("random token spreads evenly across the alphabet", () => {
    const counts = new Map<string, number>();
    for (const char of randomToken(60_000)) counts.set(char, (counts.get(char) ?? 0) + 1);
    expect(counts.size).toBe(62);
    const expected = 60_000 / 62;
    for (const count of counts.values()) expect(Math.abs(count - expected) / expected).toBeLessThan(0.2);
  });

  test("timing safe compare", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
