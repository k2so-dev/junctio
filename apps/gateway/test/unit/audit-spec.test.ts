import { describe, expect, test } from "bun:test";
import {
  auditTarget,
  isRemoteSpec,
  normalizePypiName,
  parseBunxArgs,
  parseNpxArgs,
  parseUvArgs,
  parseUvxArgs,
  splitNpmSpec,
  splitPypiRequirement
} from "../../src/audit/spec.ts";

describe("splitNpmSpec", () => {
  test("keeps a scoped name intact", () => {
    expect(splitNpmSpec("@scope/pkg@1.2.3")).toEqual({ name: "@scope/pkg", range: "1.2.3" });
  });

  test("returns a null range when no version is pinned", () => {
    expect(splitNpmSpec("@scope/pkg")).toEqual({ name: "@scope/pkg", range: null });
    expect(splitNpmSpec("pkg")).toEqual({ name: "pkg", range: null });
  });

  test("splits an unscoped spec", () => {
    expect(splitNpmSpec("pkg@^2")).toEqual({ name: "pkg", range: "^2" });
  });
});

describe("isRemoteSpec", () => {
  test("rejects anything that is not a registry package", () => {
    for (const spec of ["git+https://x/y.git", "github:a/b", "https://x/y.tgz", "./local", "/abs", "file:../x", "pkg.tgz"]) {
      expect(isRemoteSpec(spec)).toBe(true);
    }
  });

  test("accepts registry specs", () => {
    for (const spec of ["pkg", "@scope/pkg@1.0.0", "pkg@latest"]) expect(isRemoteSpec(spec)).toBe(false);
  });
});

describe("parseNpxArgs", () => {
  test("takes the first positional after the yes flag", () => {
    expect(parseNpxArgs(["-y", "@scope/server@1.2.3", "--port", "3000"])).toEqual({
      kind: "npm",
      specs: ["@scope/server@1.2.3"]
    });
  });

  test("prefers explicit package flags", () => {
    expect(parseNpxArgs(["-p", "a", "-p", "b@1", "cmd"])).toEqual({ kind: "npm", specs: ["a", "b@1"] });
    expect(parseNpxArgs(["--package=a", "cmd"])).toEqual({ kind: "npm", specs: ["a"] });
  });

  test("refuses a call without a package", () => {
    const result = parseNpxArgs(["-c", "echo hi"]);
    expect(result.kind).toBe("unsupported");
  });

  test("refuses a git spec and an empty command", () => {
    expect(parseNpxArgs(["-y", "git+https://example.com/x.git"]).kind).toBe("unsupported");
    expect(parseNpxArgs([]).kind).toBe("unsupported");
  });

  test("refuses a custom registry", () => {
    expect(parseNpxArgs(["--registry", "https://example.com", "pkg"]).kind).toBe("unsupported");
  });
});

describe("parseBunxArgs", () => {
  test("skips the bun flag", () => {
    expect(parseBunxArgs(["--bun", "server@2"])).toEqual({ kind: "npm", specs: ["server@2"] });
  });
});

describe("parseUvxArgs", () => {
  test("uses the first positional", () => {
    expect(parseUvxArgs(["mcp-server-git", "--repository", "."])).toEqual({
      kind: "pypi",
      requirements: ["mcp-server-git"]
    });
  });

  test("uses the from spec and keeps every with spec", () => {
    expect(parseUvxArgs(["--from", "pkg==1.0", "--with", "extra", "command"])).toEqual({
      kind: "pypi",
      requirements: ["pkg==1.0", "extra"]
    });
  });

  test("refuses a custom index and a requirements file", () => {
    expect(parseUvxArgs(["--index-url", "https://example.com", "pkg"]).kind).toBe("unsupported");
    expect(parseUvxArgs(["--with-requirements", "req.txt", "pkg"]).kind).toBe("unsupported");
  });
});

describe("parseUvArgs", () => {
  test("understands tool run", () => {
    expect(parseUvArgs(["tool", "run", "pkg"])).toEqual({ kind: "pypi", requirements: ["pkg"] });
  });

  test("understands run with dependencies", () => {
    expect(parseUvArgs(["run", "--with", "a", "--with", "b", "main.py"])).toEqual({
      kind: "pypi",
      requirements: ["a", "b"]
    });
  });

  test("refuses a bare project run", () => {
    expect(parseUvArgs(["run", "main.py"]).kind).toBe("unsupported");
    expect(parseUvArgs(["pip", "install", "x"]).kind).toBe("unsupported");
  });
});

describe("normalizePypiName", () => {
  test("follows the packaging name rules", () => {
    expect(normalizePypiName("Mcp_Server.Git")).toBe("mcp-server-git");
  });
});

describe("splitPypiRequirement", () => {
  test("reads a pinned version with extras", () => {
    expect(splitPypiRequirement("pkg[extra]==1.2.3")).toEqual({ name: "pkg", version: "1.2.3" });
  });

  test("drops markers", () => {
    expect(splitPypiRequirement("pkg ; python_version < '3.11'")).toEqual({ name: "pkg", version: null });
  });
});

describe("auditTarget", () => {
  const base = { transport: "stdio" as const, args: [], cwd: null };

  test("refuses remote transports", () => {
    expect(auditTarget({ ...base, transport: "http", runtime: "custom", args: [] }).kind).toBe("unsupported");
  });

  test("refuses docker and custom runtimes", () => {
    expect(auditTarget({ ...base, runtime: "docker", args: ["run", "--rm", "image"] }).kind).toBe("unsupported");
    expect(auditTarget({ ...base, runtime: "custom", args: ["/usr/bin/thing"] }).kind).toBe("unsupported");
  });

  test("refuses node without a working directory", () => {
    expect(auditTarget({ ...base, runtime: "node", args: ["server.js"] }).kind).toBe("unsupported");
  });

  test("routes npx to the npm ecosystem", () => {
    expect(auditTarget({ ...base, runtime: "npx", args: ["-y", "pkg"] })).toEqual({ kind: "npm", specs: ["pkg"] });
  });
});
