import { describe, expect, test } from "bun:test";
import { parseMcpConfig, ServerInput } from "@junctio/schema";

function only(text: string) {
  const parsed = parseMcpConfig(text);
  expect(parsed.error).toBeNull();
  expect(parsed.servers).toHaveLength(1);
  return parsed.servers[0]!;
}

describe("client config import", () => {
  test("reads the mcpServers dialect", () => {
    const entry = only(`{
      "mcpServers": {
        "filesystem": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
          "env": { "LOG_LEVEL": "debug" }
        }
      }
    }`);
    expect(entry.key).toBe("filesystem");
    expect(entry.draft?.runtime).toBe("npx");
    expect(entry.draft?.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/data"]);
    expect(entry.draft?.env).toEqual({ LOG_LEVEL: "debug" });
    expect(entry.summary).toBe("npx -y @modelcontextprotocol/server-filesystem /data");
    expect(ServerInput.safeParse(entry.draft).success).toBe(true);
  });

  test("reads the vs code servers dialect over http", () => {
    const entry = only(`{
      "servers": {
        "linear": { "type": "http", "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer t" } }
      }
    }`);
    expect(entry.draft?.transport).toBe("http");
    expect(entry.draft?.url).toBe("https://mcp.linear.app/mcp");
    expect(entry.draft?.authMode).toBe("header");
    expect(entry.summary).toBe("https://mcp.linear.app/mcp");
    expect(ServerInput.safeParse(entry.draft).success).toBe(true);
  });

  test("takes an unknown command as a custom runtime", () => {
    const entry = only(`{"mcpServers":{"local":{"command":"/usr/local/bin/my-server","args":["--flag"]}}}`);
    expect(entry.draft?.runtime).toBe("custom");
    expect(entry.draft?.args).toEqual(["/usr/local/bin/my-server", "--flag"]);
  });

  test("turns a docker command into the docker runtime", () => {
    const entry = only(`{"mcpServers":{"pg":{"command":"docker","args":["run","-i","--rm","mcp/postgres"]}}}`);
    expect(entry.draft?.runtime).toBe("docker");
    expect(entry.draft?.args).toEqual(["run", "-i", "--rm", "mcp/postgres"]);
    expect(entry.summary).toBe("docker run -i --rm mcp/postgres");
    expect(entry.notes).toEqual([]);
    expect(ServerInput.safeParse(entry.draft).success).toBe(true);
  });

  test("carries the docker refusals into the notes", () => {
    const entry = only(`{"mcpServers":{"pg":{"command":"docker","args":["run","-d","-p","5432:5432","mcp/postgres"]}}}`);
    expect(entry.draft?.runtime).toBe("docker");
    expect(entry.notes.join(" ")).toContain("stdio");
    expect(entry.notes.join(" ")).toContain("published port");
  });

  test("maps podman onto the docker runtime", () => {
    const entry = only(`{"mcpServers":{"pg":{"command":"podman","args":["run","-i","--rm","mcp/postgres"]}}}`);
    expect(entry.draft?.runtime).toBe("docker");
    expect(entry.notes.join(" ")).toContain("docker runtime");
  });

  test("blanks placeholders and says what to fill in", () => {
    const entry = only(`{
      "mcpServers": {
        "github": {
          "command": "npx",
          "args": ["-y", "@x/gh", "<repo>"],
          "env": { "TOKEN": "\${input:github-token}" }
        }
      }
    }`);
    expect(entry.draft?.env).toEqual({ TOKEN: "" });
    expect(entry.notes).toContain("fill in TOKEN");
    expect(entry.notes).toContain("replace the placeholders in the arguments");
  });

  test("imports a legacy sse entry as an sse server", () => {
    const entry = only(`{"mcpServers":{"old":{"type":"sse","url":"https://example.com/sse"}}}`);
    expect(entry.draft?.transport).toBe("sse");
    expect(entry.draft?.url).toBe("https://example.com/sse");
    expect(entry.summary).toBe("https://example.com/sse");
    expect(entry.notes[0]).toContain("SSE");
    expect(ServerInput.safeParse(entry.draft).success).toBe(true);
  });

  test("digs the object out of a fenced snippet", () => {
    const entry = only('Add this to your config:\n```json\n{"mcpServers":{"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}}\n```\nThat is all.');
    expect(entry.draft?.runtime).toBe("uvx");
  });

  test("accepts a bare server object and a bare map", () => {
    const bare = only(`{"command":"bunx","args":["mcp-server"]}`);
    expect(bare.key).toBe("server");
    expect(bare.draft?.runtime).toBe("bunx");

    const map = only(`{"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}`);
    expect(map.key).toBe("fetch");
  });

  test("reads a vs code install link", () => {
    const payload = encodeURIComponent(
      JSON.stringify({ name: "fetch", command: "uvx", args: ["mcp-server-fetch"] })
    );
    const entry = only(`vscode:mcp/install?${payload}`);
    expect(entry.key).toBe("fetch");
    expect(entry.draft?.runtime).toBe("uvx");
    expect(entry.draft?.args).toEqual(["mcp-server-fetch"]);
  });

  test("reads a cursor deeplink", () => {
    const config = btoa(JSON.stringify({ command: "npx", args: ["-y", "@x/foo"] }));
    const entry = only(`cursor://anysphere.cursor-deeplink/mcp/install?name=foo&config=${encodeURIComponent(config)}`);
    expect(entry.key).toBe("foo");
    expect(entry.draft?.args).toEqual(["-y", "@x/foo"]);
  });

  test("keeps every entry of a multi server snippet", () => {
    const parsed = parseMcpConfig(`{
      "mcpServers": {
        "a": { "command": "npx", "args": ["-y", "a"] },
        "b": { "url": "https://example.com/mcp" }
      }
    }`);
    expect(parsed.servers.map((item) => item.key)).toEqual(["a", "b"]);
  });

  test("cleans a name the gateway would refuse", () => {
    const entry = only(`{"mcpServers":{"@scope/my server":{"command":"npx","args":["-y","x"]}}}`);
    expect(entry.draft?.name).toBe("my-server");
  });

  test("says nothing about an empty box", () => {
    expect(parseMcpConfig("   ")).toEqual({ servers: [], error: null });
  });

  test("explains broken input", () => {
    expect(parseMcpConfig("not json at all").error).toContain("not valid JSON");
    expect(parseMcpConfig(`{"hello":"world"}`).error).toContain("mcpServers");
    expect(parseMcpConfig("https://mcp.so/server/foo").error).toContain("no config");
  });
});
