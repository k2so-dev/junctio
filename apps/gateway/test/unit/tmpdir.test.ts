import { describe, expect, test } from "bun:test";
import { existsSync, rmdirSync } from "node:fs";
import { checkTmpdir } from "../../src/upstream/tmpdir.ts";

describe("checkTmpdir", () => {
  test("reports the resolved directory", () => {
    const result = checkTmpdir({ TMPDIR: "/tmp" });
    expect(result.path).toBe("/tmp");
    expect(typeof result.noexec).toBe("boolean");
  });

  test("creates a missing directory", () => {
    const path = `/tmp/junctio-tmpdir-${Date.now()}`;
    expect(checkTmpdir({ TMPDIR: path }).path).toBe(path);
    expect(existsSync(path)).toBe(true);
    rmdirSync(path);
  });

  test("falls back to /tmp", () => {
    expect(checkTmpdir({}).path).toBe("/tmp");
  });
});
