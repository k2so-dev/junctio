import { describe, expect, test } from "bun:test";
import { loadConfig, requireBaseUrl } from "../../src/config.ts";

describe("config", () => {
  test("requires a secret", () => {
    expect(() => loadConfig({})).toThrow(/JUNCTIO_SECRET/);
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

  test("requireBaseUrl throws when missing", () => {
    const config = loadConfig({ JUNCTIO_SECRET: "a".repeat(32) });
    expect(() => requireBaseUrl(config, "oauth")).toThrow(/JUNCTIO_BASE_URL/);
  });
});
