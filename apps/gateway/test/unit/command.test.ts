import { describe, expect, test } from "bun:test";
import { buildArgv, buildChildEnv, previewCommand } from "../../src/upstream/command.ts";

describe("buildArgv", () => {
  test("npx adds the yes flag", () => {
    expect(buildArgv({ runtime: "npx", command: "@scope/pkg", args: ["--flag"] })).toEqual([
      "npx",
      "-y",
      "@scope/pkg",
      "--flag"
    ]);
  });

  test("bunx does not add the yes flag", () => {
    expect(buildArgv({ runtime: "bunx", command: "pkg", args: [] })).toEqual(["bunx", "pkg"]);
  });

  test("uvx passes the package through", () => {
    expect(buildArgv({ runtime: "uvx", command: "mcp-server-git", args: ["--repo", "."] })).toEqual([
      "uvx",
      "mcp-server-git",
      "--repo",
      "."
    ]);
  });

  test("node runs a script", () => {
    expect(buildArgv({ runtime: "node", command: "server.js", args: ["--port", "1"] })).toEqual([
      "node",
      "server.js",
      "--port",
      "1"
    ]);
  });

  test("uv runs with the run subcommand", () => {
    expect(buildArgv({ runtime: "uv", command: "", args: ["main.py"] })).toEqual(["uv", "run", "main.py"]);
  });

  test("custom keeps the command as is", () => {
    expect(buildArgv({ runtime: "custom", command: "/usr/bin/thing", args: ["a"] })).toEqual(["/usr/bin/thing", "a"]);
  });
});

describe("previewCommand", () => {
  test("quotes arguments with spaces", () => {
    expect(previewCommand({ runtime: "custom", command: "cmd", args: ["two words"] })).toBe("cmd 'two words'");
  });

  test("renders a npx invocation", () => {
    expect(previewCommand({ runtime: "npx", command: "@modelcontextprotocol/server-everything", args: [] })).toBe(
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
