import { describe, expect, test } from "bun:test";
import { createCipher, newCipherSalt, randomToken, sha256Hex, timingSafeEqual } from "../../src/crypto.ts";

const SECRET = "test-secret-value-0123456789abcdef";
const salt = newCipherSalt();
const cipher = createCipher(SECRET, salt);

describe("cipher", () => {
  test("round trips a value", async () => {
    const sealed = await cipher.encrypt("ghp_token");
    expect(sealed.startsWith("v2.")).toBe(true);
    expect(sealed).not.toContain("ghp_token");
    expect(await cipher.decrypt(sealed)).toBe("ghp_token");
  });

  test("never repeats a ciphertext", async () => {
    expect(await cipher.encrypt("same")).not.toBe(await cipher.encrypt("same"));
  });

  test("refuses a ciphertext sealed with another secret", async () => {
    const other = createCipher("another-secret-0123456789abcdefgh", salt);
    await expect(other.decrypt(await cipher.encrypt("value"))).rejects.toThrow();
  });

  test("refuses a ciphertext sealed with another salt", async () => {
    const other = createCipher(SECRET, newCipherSalt());
    await expect(other.decrypt(await cipher.encrypt("value"))).rejects.toThrow();
  });

  test("refuses the retired format and malformed payloads", async () => {
    await expect(cipher.decrypt("v1.abcd")).rejects.toThrow("unsupported ciphertext format");
    await expect(cipher.decrypt("plain")).rejects.toThrow("unsupported ciphertext format");
    await expect(cipher.decrypt("v2.YWJj")).rejects.toThrow("malformed ciphertext");
  });

  test("passes null through", async () => {
    expect(await cipher.encryptNullable(null)).toBeNull();
    expect(await cipher.decryptNullable(undefined)).toBeNull();
  });
});

describe("tokens", () => {
  test("uses the whole alphabet and the requested length", () => {
    const token = randomToken(64);
    expect(token).toHaveLength(64);
    expect(/^[A-Za-z0-9]+$/.test(token)).toBe(true);
    expect(randomToken(32)).not.toBe(randomToken(32));
  });

  test("hashes deterministically", () => {
    expect(sha256Hex("value")).toBe(sha256Hex("value"));
    expect(sha256Hex("value")).not.toBe(sha256Hex("other"));
  });

  test("compares without leaking through timing", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
