import { describe, expect, test } from "bun:test";
import { parseDockerRun, ServerInput } from "@junctio/schema";

function spec(args: string[], env: Record<string, string> = {}) {
  const parsed = parseDockerRun(args, env);
  expect(parsed.errors).toEqual([]);
  expect(parsed.spec).not.toBeNull();
  return parsed.spec!;
}

describe("docker run arguments", () => {
  test("reads the snippet every site shows", () => {
    const result = spec(
      ["run", "-i", "--rm", "-e", "GITHUB_TOKEN", "ghcr.io/github/github-mcp-server"],
      { GITHUB_TOKEN: "ghp_x" }
    );
    expect(result.image).toBe("ghcr.io/github/github-mcp-server");
    expect(result.cmd).toEqual([]);
    expect(result.env.GITHUB_TOKEN).toBe("ghp_x");
  });

  test("keeps the command after the image", () => {
    const result = spec(["run", "-i", "--rm", "mcp/postgres", "postgresql://localhost/db", "--read-only"]);
    expect(result.image).toBe("mcp/postgres");
    expect(result.cmd).toEqual(["postgresql://localhost/db", "--read-only"]);
  });

  test("takes an inline env pair over the ambient one", () => {
    const result = spec(["run", "-e", "LEVEL=debug", "img"], { LEVEL: "info", OTHER: "kept" });
    expect(result.env).toEqual({ LEVEL: "debug", OTHER: "kept" });
  });

  test("refuses -e without a value the environment does not have", () => {
    const parsed = parseDockerRun(["run", "-e", "TOKEN", "img"]);
    expect(parsed.spec).toBeNull();
    expect(parsed.errors[0]).toContain("set TOKEN in Environment");
  });

  test("collects binds from -v and --mount", () => {
    const result = spec([
      "run",
      "-v",
      "/host/data:/data:ro",
      "--mount",
      "type=bind,src=/host/src,dst=/src,readonly",
      "--mount",
      "type=volume,source=cache,target=/cache",
      "img"
    ]);
    expect(result.binds).toEqual(["/host/data:/data:ro", "/host/src:/src:ro", "cache:/cache"]);
  });

  test("refuses a mount type it cannot build", () => {
    const parsed = parseDockerRun(["run", "--mount", "type=tmpfs,target=/tmp", "img"]);
    expect(parsed.errors[0]).toContain("tmpfs");
    expect(parseDockerRun(["run", "--mount", "type=bind,src=/x", "img"]).errors[0]).toContain("target");
  });

  test("reads the flags the daemon needs spelled out", () => {
    const result = spec([
      "run",
      "--network=host",
      "-w",
      "/app",
      "-u",
      "1000:1000",
      "--entrypoint",
      "/bin/server",
      "--init",
      "--pull",
      "always",
      "--label",
      "team=infra",
      "img"
    ]);
    expect(result.network).toBe("host");
    expect(result.workdir).toBe("/app");
    expect(result.user).toBe("1000:1000");
    expect(result.entrypoint).toEqual(["/bin/server"]);
    expect(result.init).toBe(true);
    expect(result.pull).toBe("always");
    expect(result.labels).toEqual({ team: "infra" });
  });

  test("notes the flags it ignores instead of failing", () => {
    const parsed = parseDockerRun(["run", "-t", "--name", "mine", "--platform", "linux/amd64", "img"]);
    expect(parsed.spec?.image).toBe("img");
    expect(parsed.notes.join(" ")).toContain("tty");
    expect(parsed.notes.join(" ")).toContain("names containers itself");
  });

  test("refuses what the gateway cannot honour", () => {
    expect(parseDockerRun(["run", "-d", "img"]).errors[0]).toContain("stdio");
    expect(parseDockerRun(["run", "-p", "8080:80", "img"]).errors[0]).toContain("no published port");
    expect(parseDockerRun(["run", "--privileged", "img"]).errors[0]).toContain("--privileged");
    expect(parseDockerRun(["run", "--env-file", ".env", "img"]).errors[0]).toContain("Environment");
    expect(parseDockerRun(["run", "--cpus", "2", "img"]).errors[0]).toContain("unsupported flag --cpus");
  });

  test("insists on run and an image", () => {
    expect(parseDockerRun([]).errors[0]).toContain("start with run");
    expect(parseDockerRun(["exec", "img"]).errors[0]).toContain("not exec");
    expect(parseDockerRun(["run", "-i", "--rm"]).errors[0]).toContain("no image");
    expect(parseDockerRun(["run", "--pull", "sometimes", "img"]).errors[0]).toContain("always, missing or never");
  });

  test("stops reading flags after a bare double dash", () => {
    const result = spec(["run", "-i", "--", "img", "-v"]);
    expect(result.image).toBe("img");
    expect(result.cmd).toEqual(["-v"]);
  });

  test("the server schema rejects arguments the parser refuses", () => {
    const base = {
      name: "gh",
      transport: "stdio" as const,
      runtime: "docker" as const,
      env: { TOKEN: "x" }
    };
    expect(ServerInput.safeParse({ ...base, args: ["run", "-i", "--rm", "-e", "TOKEN", "img"] }).success).toBe(true);
    const bad = ServerInput.safeParse({ ...base, args: ["run", "--privileged", "img"] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain("--privileged");
    expect(bad.error?.issues[0]?.path).toEqual(["args"]);
  });
});
