import { describe, expect, test } from "bun:test";
import { loadConfig, requireBaseUrl } from "../../src/config.ts";

describe("config", () => {
  test("requires a secret", () => {
    expect(() => loadConfig({})).toThrow(/JUNCTIO_SECRET/);
  });

  test("rejects a secret that is too short", () => {
    expect(() => loadConfig({ JUNCTIO_SECRET: "a".repeat(31) })).toThrow(/at least 32/);
  });

  test("applies defaults", () => {
    const config = loadConfig({ JUNCTIO_SECRET: "a".repeat(32) });
    expect(config.port).toBe(3000);
    expect(config.dataDir).toBe("/data");
    expect(config.baseUrl).toBeNull();
  });

  test("strips trailing slash from base url", () => {
    const config = loadConfig({ JUNCTIO_SECRET: "a".repeat(32), JUNCTIO_BASE_URL: "https://mcp.example.com/" });
    expect(config.baseUrl).toBe("https://mcp.example.com");
  });

  test("treats empty variables as unset", () => {
    const config = loadConfig({
      JUNCTIO_SECRET: "a".repeat(32),
      JUNCTIO_BASE_URL: "",
      JUNCTIO_ADMIN_TOKEN: "",
      JUNCTIO_OAUTH_ISSUER: "  ",
      JUNCTIO_OAUTH_AUDIENCE: ""
    });
    expect(config.baseUrl).toBeNull();
    expect(config.adminToken).toBeNull();
    expect(config.oauthIssuer).toBeNull();
    expect(config.oauthAudience).toBeNull();
  });

  test("rejects a malformed base url", () => {
    expect(() => loadConfig({ JUNCTIO_SECRET: "a".repeat(32), JUNCTIO_BASE_URL: "not a url" })).toThrow(
      /JUNCTIO_BASE_URL/
    );
  });

  test("requireBaseUrl throws when missing", () => {
    const config = loadConfig({ JUNCTIO_SECRET: "a".repeat(32) });
    expect(() => requireBaseUrl(config, "oauth")).toThrow(/JUNCTIO_BASE_URL/);
  });
});
