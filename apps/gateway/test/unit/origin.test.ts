import { describe, expect, test } from "bun:test";
import { checkOrigin } from "../../src/server/origin.ts";

function request(headers: Record<string, string>, url = "http://127.0.0.1:3000/api/v1/servers"): Request {
  return new Request(url, { method: "POST", headers });
}

describe("origin check", () => {
  test("passes a request without an origin header", () => {
    expect(checkOrigin(request({}), "https://mcp.example.com")).toBeNull();
  });

  test("rejects an unparseable origin", () => {
    expect(checkOrigin(request({ origin: "not a url" }), null)).toBe("invalid origin header");
  });

  test("accepts the configured base url", () => {
    expect(checkOrigin(request({ origin: "https://mcp.example.com" }), "https://mcp.example.com/")).toBeNull();
  });

  test("rejects a foreign origin that echoes the host header", () => {
    const rebinding = request({ origin: "http://mcp.example.com", host: "mcp.example.com" });
    expect(checkOrigin(rebinding, "https://mcp.example.com")).toBe("origin not allowed");
  });

  test("rejects http when the base url is https", () => {
    expect(checkOrigin(request({ origin: "http://mcp.example.com" }), "https://mcp.example.com")).toBe(
      "origin not allowed"
    );
  });

  test("reports a malformed base url", () => {
    expect(checkOrigin(request({ origin: "https://mcp.example.com" }), "not a url")).toBe("invalid base url");
  });

  test("accepts a loopback origin matching the host when no base url is set", () => {
    const local = request({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" });
    expect(checkOrigin(local, null)).toBeNull();
  });

  test("rejects a loopback origin on another port", () => {
    const other = request({ origin: "http://localhost:9999", host: "127.0.0.1:3000" });
    expect(checkOrigin(other, null)).toContain("origin not allowed");
  });

  test("rejects a public origin when no base url is set", () => {
    const evil = request({ origin: "https://evil.example.com", host: "evil.example.com" });
    expect(checkOrigin(evil, null)).toContain("origin not allowed");
  });
});
