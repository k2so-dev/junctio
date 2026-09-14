import { describe, expect, test } from "bun:test";
import { maskString } from "../../src/log.ts";

describe("log masking", () => {
  test("masks bearer tokens", () => {
    expect(maskString("Authorization: Bearer abcdef1234567890")).toBe("Authorization: Bearer ***");
  });

  test("masks junctio api keys", () => {
    expect(maskString("key jn_AbCdEf123456 used")).toBe("key *** used");
  });

  test("masks jwt", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop";
    expect(maskString(`token=${jwt}`)).toBe("token=***");
  });

  test("leaves plain text alone", () => {
    expect(maskString("server started on port 3000")).toBe("server started on port 3000");
  });
});
