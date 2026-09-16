import { describe, expect, test } from "bun:test";
import fixture from "../fixtures/registry-list.json" with { type: "json" };
import {
  installOptions,
  serverKinds,
  serverLinks,
  serverName,
  summarize,
  uniqueName
} from "../../src/registry/install.ts";
import { registryEntries, type RegistryEntry } from "../../src/registry/types.ts";

const entries = registryEntries(fixture as never);

function entry(name: string): RegistryEntry {
  const found = entries.find((item) => item.server.name === name);
  if (!found) throw new Error(`fixture is missing ${name}`);
  return found;
}

describe("registry names", () => {
  test("takes the tail of a reverse dns name", () => {
    expect(serverName("io.github.j0hanz/filesystem-mcp")).toBe("filesystem-mcp");
    expect(serverName("com.pulsemcp/remote-filesystem")).toBe("remote-filesystem");
  });

  test("strips characters a server name may not carry", () => {
    expect(serverName("ai.smithery/@scope/pkg.name")).toBe("pkg-name");
    expect(serverName("...")).toBe("server");
  });

  test("suffixes a name that is already taken", () => {
    const taken = new Set(["filesystem-mcp", "filesystem-mcp-2"]);
    expect(uniqueName("filesystem-mcp", taken)).toBe("filesystem-mcp-3");
    expect(uniqueName("fresh", taken)).toBe("fresh");
  });
});

describe("install options", () => {
  test("turns an npm package into an npx command with its environment", () => {
    const options = installOptions(entry("com.pulsemcp/remote-filesystem"), "remote-filesystem");
    expect(options).toHaveLength(1);
    const option = options[0]!;
    expect(option.supported).toBe(true);
    expect(option.kind).toBe("npm");
    expect(option.draft?.runtime).toBe("npx");
    expect(option.draft?.args).toEqual(["-y", "-y", "remote-filesystem-mcp-server@0.1.5"]);
    expect(option.draft?.env.GCS_BUCKET).toBe("");
    expect(option.inputs.find((input) => input.name === "GCS_BUCKET")?.required).toBe(true);
    expect(option.inputs.find((input) => input.name === "GCS_PRIVATE_KEY")?.secret).toBe(true);
  });

  test("keeps positional arguments as placeholders to fill in", () => {
    const options = installOptions(entry("io.github.j0hanz/filesystem-mcp"), "filesystem-mcp");
    const npm = options.find((option) => option.kind === "npm");
    expect(npm?.draft?.args).toEqual(["-y", "@j0hanz/filesystem-mcp@2.2.0", "<allowed_directory>"]);
  });

  test("turns a pypi package into a uvx command", () => {
    const options = installOptions(entry("io.github.Oncorporation/filesystem-server"), "filesystem-server");
    const option = options[0]!;
    expect(option.kind).toBe("pypi");
    expect(option.draft?.runtime).toBe("uvx");
    expect(option.draft?.args).toEqual(["vs-filesystem-mcp-server==0.1.3"]);
  });

  test("turns a streamable http remote into an http server and keeps the header template", () => {
    const options = installOptions(entry("ai.smithery/222wcnm-bilistalkermcp"), "bilistalkermcp");
    const option = options[0]!;
    expect(option.kind).toBe("remote");
    expect(option.supported).toBe(true);
    expect(option.draft?.transport).toBe("http");
    expect(option.draft?.url).toBe("https://server.smithery.ai/@222wcnm/bilistalkermcp/mcp");
    expect(option.draft?.authMode).toBe("header");
    expect(option.draft?.headers.Authorization).toBe("Bearer {smithery_api_key}");
    expect(option.inputs[0]?.name).toBe("Authorization");
  });

  test("prefills an sse remote as an sse server", () => {
    const sse = installOptions(entry("io.github.Evozim/chroot-filesystem-jail-mcp"), "chroot")[0]!;
    expect(sse.supported).toBe(true);
    expect(sse.draft?.transport).toBe("sse");
    expect(sse.draft?.url).toBe("https://api.m2mcent.com/chroot-filesystem-jail-mcp/sse");
  });

  test("refuses what the gateway cannot run and says why", () => {
    const nuget = installOptions(entry("io.github.dotnetmcp/nuget-filesystem"), "nuget-filesystem")[0]!;
    expect(nuget.supported).toBe(false);
    expect(nuget.reason).toContain("dotnet toolchain");
    expect(nuget.draft).toBeNull();
  });

  test("turns a container image into a docker server", () => {
    const oci = installOptions(entry("io.github.j0hanz/filesystem-mcp"), "filesystem-mcp").find((option) =>
      option.label.startsWith("oci")
    );
    expect(oci?.supported).toBe(true);
    expect(oci?.draft?.runtime).toBe("docker");
    expect(oci?.draft?.args.slice(0, 3)).toEqual(["run", "-i", "--rm"]);
    expect(oci?.draft?.args).toContain("ghcr.io/j0hanz/filesystem-mcp:2.2.0");
    expect(oci?.draft?.args.join(" ")).toContain("-v");
  });
});

describe("links", () => {
  test("points at the repository, the package page and the registry entry", () => {
    const links = serverLinks(entry("io.github.j0hanz/filesystem-mcp"));
    expect(links.map((link) => link.kind)).toEqual(["repository", "npm", "registry"]);
    expect(links[0]?.url).toBe("https://github.com/j0hanz/filesystem-mcp");
    expect(links[1]?.url).toBe("https://www.npmjs.com/package/@j0hanz/filesystem-mcp");
    expect(links[2]?.url).toBe(
      "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.j0hanz%2Ffilesystem-mcp/versions/2.2.0"
    );
  });

  test("sends a python package to pypi", () => {
    const links = serverLinks(entry("io.github.Oncorporation/filesystem-server"));
    expect(links.find((link) => link.kind === "pypi")?.url).toBe("https://pypi.org/project/vs-filesystem-mcp-server/");
  });

  test("only links a package page for the official registries", () => {
    const original = entry("io.github.j0hanz/filesystem-mcp");
    const forged = (base: string): RegistryEntry => ({
      ...original,
      server: {
        ...original.server,
        packages: (original.server.packages ?? []).map((item) => ({ ...item, registryBaseUrl: base }))
      }
    });
    expect(serverLinks(forged("https://registry.npmjs.org")).some((link) => link.kind === "npm")).toBe(true);
    expect(serverLinks(forged("https://npmjs.org.example.com")).some((link) => link.kind === "npm")).toBe(false);
    expect(serverLinks(forged("https://example.com/npmjs.org")).some((link) => link.kind === "npm")).toBe(false);
    expect(serverLinks(forged("not a url")).some((link) => link.kind === "npm")).toBe(false);
  });

  test("always offers the registry entry, even with nothing else to link", () => {
    const links = serverLinks(entry("io.github.Evozim/chroot-filesystem-jail-mcp"));
    expect(links).toHaveLength(1);
    expect(links[0]?.kind).toBe("registry");
  });

  test("does not repeat a website that is the repository", () => {
    const links = serverLinks(entry("io.github.j0hanz/filesystem-mcp"));
    expect(links.filter((link) => link.url === "https://github.com/j0hanz/filesystem-mcp")).toHaveLength(1);
  });
});

describe("summaries", () => {
  test("lists the kinds a server ships", () => {
    expect(serverKinds(entry("io.github.j0hanz/filesystem-mcp")).sort()).toEqual(["npm", "other"]);
    expect(serverKinds(entry("ai.smithery/222wcnm-bilistalkermcp"))).toEqual(["remote"]);
  });

  test("marks an entry with no runnable option as not installable", () => {
    expect(summarize(entry("io.github.dotnetmcp/nuget-filesystem"), false).installable).toBe(false);
    expect(summarize(entry("com.pulsemcp/remote-filesystem"), false).installable).toBe(true);
  });
});
