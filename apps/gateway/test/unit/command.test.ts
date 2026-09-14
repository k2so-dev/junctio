import { describe, expect, test } from "bun:test";
import { buildArgv, buildChildEnv, previewCommand } from "../../src/upstream/command.ts";

describe("buildArgv", () => {
  test("prefixes the arguments with the runtime", () => {
    expect(buildArgv({ runtime: "npx", args: ["-y", "@scope/pkg", "--flag"] })).toEqual([
      "npx",
      "-y",
      "@scope/pkg",
      "--flag"
    ]);
    expect(buildArgv({ runtime: "bunx", args: ["pkg"] })).toEqual(["bunx", "pkg"]);
    expect(buildArgv({ runtime: "uvx", args: ["mcp-server-git", "--repo", "."] })).toEqual([
      "uvx",
      "mcp-server-git",
      "--repo",
      "."
    ]);
    expect(buildArgv({ runtime: "uv", args: ["run", "main.py"] })).toEqual(["uv", "run", "main.py"]);
  });

  test("adds nothing on its own", () => {
    expect(buildArgv({ runtime: "npx", args: ["pkg"] })).toEqual(["npx", "pkg"]);
  });

  test("custom takes the executable from the first argument", () => {
    expect(buildArgv({ runtime: "custom", args: ["/usr/bin/thing", "a"] })).toEqual(["/usr/bin/thing", "a"]);
  });

  test("drops blank arguments", () => {
    expect(buildArgv({ runtime: "node", args: ["", " ", "server.js"] })).toEqual(["node", "server.js"]);
  });
});

describe("previewCommand", () => {
  test("quotes arguments with spaces", () => {
    expect(previewCommand({ runtime: "custom", args: ["cmd", "two words"] })).toBe("cmd 'two words'");
  });

  test("renders a npx invocation", () => {
    expect(previewCommand({ runtime: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] })).toBe(
      "npx -y @modelcontextprotocol/server-everything"
    );
  });
});

describe("buildChildEnv", () => {
  test("uses the explicit path and drops junctio variables", () => {
    const env = buildChildEnv({ env: { FOO: "bar", JUNCTIO_SECRET: "leak" }, path: "/bin", home: "/home/x" });
    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.FOO).toBe("bar");
    expect(env.JUNCTIO_SECRET).toBeUndefined();
  });

  test("does not inherit arbitrary parent variables", () => {
    const env = buildChildEnv({ env: {}, path: "/bin", home: "/home/x" });
    expect(Object.keys(env)).not.toContain("PWD");
  });
});
