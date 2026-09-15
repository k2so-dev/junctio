import { describe, expect, test } from "bun:test";
import { RateLimiter, clientAddress } from "../../src/server/ratelimit.ts";

function request(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/v1/session/login", { method: "POST", headers });
}

describe("client address", () => {
  test("ignores forwarded headers unless the proxy is trusted", () => {
    const forged = request({ "x-forwarded-for": "9.9.9.9", "x-real-ip": "8.8.8.8" });
    expect(clientAddress(forged, { ip: "10.0.0.5", trustProxy: false })).toBe("10.0.0.5");
  });

  test("takes the entry the fronting proxy appended, not the client-supplied one", () => {
    const chained = request({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" });
    expect(clientAddress(chained, { ip: "10.0.0.5", trustProxy: true })).toBe("203.0.113.7");
  });

  test("falls back to the real ip header and then the socket", () => {
    expect(clientAddress(request({ "x-real-ip": "8.8.8.8" }), { ip: "10.0.0.5", trustProxy: true })).toBe("8.8.8.8");
    expect(clientAddress(request({}), { ip: "10.0.0.5", trustProxy: true })).toBe("10.0.0.5");
    expect(clientAddress(request({}), { ip: null, trustProxy: true })).toBe("unknown");
  });
});

describe("rate limiter", () => {
  test("allows up to the limit and then refuses", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(true);
    const refused = limiter.check("a", 0);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBeGreaterThan(0);
  });

  test("keys are independent and windows expire", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
    expect(limiter.check("a", 1001).allowed).toBe(true);
  });

  test("a reset clears one key", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
    limiter.reset("a");
    expect(limiter.check("a", 0).allowed).toBe(true);
  });
});
