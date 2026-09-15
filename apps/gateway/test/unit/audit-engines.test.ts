import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR, selfTarget } from "../../src/audit/engines/self.ts";
import {
  affectedVersions,
  manifestFor,
  parseBunAuditOutput,
  parseLockVersions,
  toFindings,
  toSeverity
} from "../../src/audit/engines/npm.ts";
import {
  canonicalId,
  cvssScore,
  parseCompiledRequirements,
  severityFromCvss,
  severityFromOsv
} from "../../src/audit/engines/pypi.ts";

const REPORT = {
  esbuild: [
    {
      id: 1102341,
      url: "https://github.com/advisories/GHSA-67mh-4wv8-2f99",
      title: "esbuild enables any website to send any requests to the development server",
      severity: "moderate",
      vulnerable_versions: "<=0.24.2",
      cvss: { score: 5.3, vectorString: "CVSS:3.1/AV:N" }
    }
  ]
};

describe("parseBunAuditOutput", () => {
  test("skips the timing line bun prints when a dotenv file exists", () => {
    const stdout = `[0.10ms] ".env"\n${JSON.stringify(REPORT)}`;
    expect(parseBunAuditOutput(stdout)).toEqual(REPORT);
  });

  test("reads pretty printed json spread over several lines", () => {
    expect(parseBunAuditOutput(`noise\n${JSON.stringify(REPORT, null, 2)}\n`)).toEqual(REPORT);
  });

  test("treats an empty object as clean", () => {
    expect(parseBunAuditOutput("{}")).toEqual({});
  });

  test("refuses to read silence as a clean result", () => {
    expect(() => parseBunAuditOutput("   ")).toThrow("did not return json");
    expect(() => parseBunAuditOutput("")).toThrow("did not return json");
  });

  test("throws when there is no json at all", () => {
    expect(() => parseBunAuditOutput("error: something broke")).toThrow("did not return json");
  });
});

describe("toFindings", () => {
  test("uses the advisory identifier from the url and attaches the resolved version", () => {
    const findings = toFindings(REPORT, new Map([["esbuild", ["0.24.0"]]]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("GHSA-67MH-4WV8-2F99");
    expect(findings[0]?.aliases).toEqual(["NPM:1102341"]);
    expect(findings[0]?.package).toBe("esbuild");
    expect(findings[0]?.version).toBe("0.24.0");
    expect(findings[0]?.severity).toBe("moderate");
    expect(findings[0]?.cvss).toBe(5.3);
  });

  test("names only the versions the advisory covers", () => {
    const findings = toFindings(REPORT, new Map([["esbuild", ["0.18.20", "0.25.12", "0.28.2"]]]));
    expect(findings[0]?.version).toBe("0.18.20");
  });

  test("lists every installed version when the range cannot be matched", () => {
    const findings = toFindings({ pkg: [{ id: 1, severity: "high" }] }, new Map([["pkg", ["1.0.0", "2.0.0"]]]));
    expect(findings[0]?.version).toBe("1.0.0, 2.0.0");
  });

  test("falls back to the numeric advisory id", () => {
    const findings = toFindings({ pkg: [{ id: 42, severity: "high" }] }, new Map());
    expect(findings[0]?.id).toBe("NPM:42");
    expect(findings[0]?.version).toBeNull();
  });
});

describe("toSeverity", () => {
  test("maps the npm vocabulary", () => {
    expect(toSeverity("CRITICAL")).toBe("critical");
    expect(toSeverity("medium")).toBe("moderate");
    expect(toSeverity("info")).toBe("unknown");
    expect(toSeverity(undefined)).toBe("unknown");
  });
});

describe("manifestFor", () => {
  test("pins what the arguments pin and asks for latest otherwise", () => {
    const manifest = JSON.parse(manifestFor(["@scope/pkg@1.2.3", "other"]));
    expect(manifest.dependencies).toEqual({ "@scope/pkg": "1.2.3", other: "latest" });
    expect(manifest.private).toBe(true);
  });
});

describe("parseLockVersions", () => {
  test("reads names and versions out of a bun lockfile", () => {
    const lock = `{\n  "packages": {\n    "esbuild": ["esbuild@0.24.0", {}, "sha"],\n    "web/esbuild": ["esbuild@0.18.20", {}, "sha"],\n    "@scope/pkg": ["@scope/pkg@2.1.0", {}, "sha"]\n  }\n}`;
    const versions = parseLockVersions(lock);
    expect(versions.get("esbuild")).toEqual(["0.18.20", "0.24.0"]);
    expect(versions.get("@scope/pkg")).toEqual(["2.1.0"]);
  });
});

describe("parseCompiledRequirements", () => {
  test("keeps pinned packages and drops comments, markers and flags", () => {
    const stdout = [
      "# via nothing",
      "mcp-server-git==0.6.2",
      "GitPython==3.1.43 ; python_version >= '3.7'",
      "-e .",
      "pkg[extra]==1.0.0",
      "mcp-server-git==0.6.2"
    ].join("\n");
    expect(parseCompiledRequirements(stdout)).toEqual([
      { name: "mcp-server-git", version: "0.6.2" },
      { name: "gitpython", version: "3.1.43" },
      { name: "pkg", version: "1.0.0" }
    ]);
  });
});

describe("severityFromOsv", () => {
  test("prefers the database specific severity", () => {
    expect(severityFromOsv({ id: "PYSEC-1", database_specific: { severity: "HIGH" } }, null)).toBe("high");
  });

  test("falls back to the github advisory alias", () => {
    const vuln = { id: "PYSEC-1", aliases: ["GHSA-aaaa-bbbb-cccc"] };
    const ghsa = { id: "GHSA-aaaa-bbbb-cccc", database_specific: { severity: "CRITICAL" } };
    expect(severityFromOsv(vuln, ghsa)).toBe("critical");
  });

  test("falls back to the cvss score and then to unknown", () => {
    const scored = { id: "PYSEC-2", severity: [{ type: "CVSS_V3", score: "9.8" }] };
    expect(severityFromOsv(scored, null)).toBe("critical");
    expect(severityFromOsv({ id: "PYSEC-3" }, null)).toBe("unknown");
  });

  test("maps medium onto moderate", () => {
    expect(severityFromOsv({ id: "PYSEC-4", database_specific: { severity: "MEDIUM" } }, null)).toBe("moderate");
  });
});

describe("severityFromCvss", () => {
  test("follows the common score bands", () => {
    expect(severityFromCvss(9.1)).toBe("critical");
    expect(severityFromCvss(7)).toBe("high");
    expect(severityFromCvss(4.5)).toBe("moderate");
    expect(severityFromCvss(1.2)).toBe("low");
    expect(severityFromCvss(null)).toBe("unknown");
  });
});

describe("cvssScore", () => {
  test("reads the first numeric score", () => {
    expect(cvssScore({ id: "x", severity: [{ score: "not a number" }, { score: "6.1" }] })).toBe(6.1);
    expect(cvssScore({ id: "x" })).toBeNull();
  });
});

describe("canonicalId", () => {
  test("promotes a github advisory alias to the identifier", () => {
    expect(canonicalId({ id: "PYSEC-2024-1", aliases: ["CVE-2024-1", "GHSA-aaaa-bbbb-cccc"] })).toEqual({
      id: "GHSA-AAAA-BBBB-CCCC",
      aliases: ["PYSEC-2024-1", "CVE-2024-1"]
    });
  });

  test("keeps a github identifier as is", () => {
    expect(canonicalId({ id: "GHSA-aaaa-bbbb-cccc", aliases: ["CVE-2024-1"] })).toEqual({
      id: "GHSA-AAAA-BBBB-CCCC",
      aliases: ["CVE-2024-1"]
    });
  });
});

describe("affectedVersions", () => {
  test("keeps only what the vulnerable range covers", () => {
    expect(affectedVersions(["0.18.20", "0.25.12"], "<=0.24.2")).toBe("0.18.20");
  });

  test("returns every version when there is no range", () => {
    expect(affectedVersions(["1.0.0", "2.0.0"], undefined)).toBe("1.0.0, 2.0.0");
  });

  test("returns nothing when nothing is installed", () => {
    expect(affectedVersions([], "<1")).toBeNull();
  });
});

describe("self target", () => {
  test("resolves the workspace root rather than the gateway package", () => {
    expect(existsSync(join(APP_DIR, "bun.lock"))).toBe(true);
    expect(selfTarget()).toEqual({ kind: "self", appDir: APP_DIR });
  });

  test("reports a directory without the lockfile as unsupported", () => {
    expect(selfTarget(join(APP_DIR, "apps", "gateway"))).toEqual({
      kind: "unsupported",
      reason: "bun.lock is not shipped in this image, the gateway cannot audit itself"
    });
  });
});
