import { describe, expect, test } from "bun:test";
import { DEFAULT_ACTIONS, decide, isIgnored, parseActionMap, shouldLift } from "../../src/audit/policy.ts";
import type { ActionMap, AuditFinding } from "../../src/audit/types.ts";

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id: "GHSA-AAAA-BBBB-CCCC",
    aliases: ["CVE-2024-1"],
    package: "pkg",
    version: "1.0.0",
    vulnerableRange: "<2",
    title: "something",
    severity: "critical",
    cvss: 9.1,
    url: null,
    ...overrides
  };
}

describe("parseActionMap", () => {
  test("falls back to the defaults on broken input", () => {
    expect(parseActionMap("not json")).toEqual(DEFAULT_ACTIONS);
    expect(parseActionMap("null")).toEqual(DEFAULT_ACTIONS);
  });

  test("keeps valid entries and repairs the rest", () => {
    expect(parseActionMap(JSON.stringify({ critical: "disable", high: "nuke" }))).toEqual({
      ...DEFAULT_ACTIONS,
      critical: "disable"
    });
  });
});

describe("decide", () => {
  test("reports nothing when there are no findings", () => {
    const decision = decide([], new Set(), DEFAULT_ACTIONS);
    expect(decision.action).toBeNull();
    expect(decision.worst).toBeNull();
    expect(decision.reason).toBeNull();
  });

  test("picks the strongest action across findings", () => {
    const decision = decide([finding({ severity: "low" }), finding({ severity: "critical" })], new Set(), DEFAULT_ACTIONS);
    expect(decision.action).toBe("quarantine");
    expect(decision.worst).toBe("critical");
    expect(decision.counts.critical).toBe(1);
    expect(decision.counts.low).toBe(1);
  });

  test("treats an unknown severity as high but reports it as unknown", () => {
    const actions: ActionMap = { ...DEFAULT_ACTIONS, high: "quarantine", moderate: "ignore" };
    const decision = decide([finding({ severity: "unknown" })], new Set(), actions);
    expect(decision.action).toBe("quarantine");
    expect(decision.worst).toBe("unknown");
    expect(decision.counts.unknown).toBe(1);
  });

  test("ranks an unknown severity above a moderate one", () => {
    const decision = decide(
      [finding({ severity: "moderate" }), finding({ id: "GHSA-DDDD-EEEE-FFFF", severity: "unknown" })],
      new Set(),
      DEFAULT_ACTIONS
    );
    expect(decision.worst).toBe("unknown");
  });

  test("ignores an advisory by identifier and by alias", () => {
    const byId = decide([finding()], new Set(["GHSA-AAAA-BBBB-CCCC"]), DEFAULT_ACTIONS);
    expect(byId.action).toBeNull();
    expect(byId.ignored).toHaveLength(1);
    const byAlias = decide([finding()], new Set(["CVE-2024-1"]), DEFAULT_ACTIONS);
    expect(byAlias.action).toBeNull();
    expect(byAlias.active).toHaveLength(0);
  });

  test("names the packages in the reason", () => {
    const decision = decide([finding()], new Set(), DEFAULT_ACTIONS);
    expect(decision.reason).toContain("1 critical");
    expect(decision.reason).toContain("GHSA-AAAA-BBBB-CCCC in pkg@1.0.0");
  });
});

describe("isIgnored", () => {
  test("compares case insensitively", () => {
    expect(isIgnored(finding(), new Set(["ghsa-aaaa-bbbb-cccc".toUpperCase()]))).toBe(true);
    expect(isIgnored(finding(), new Set())).toBe(false);
  });
});

describe("shouldLift", () => {
  const clean = decide([], new Set(), DEFAULT_ACTIONS);
  const critical = decide([finding()], new Set(), DEFAULT_ACTIONS);

  test("lifts when a later audit is clean", () => {
    expect(shouldLift(true, "ok", clean)).toBe(true);
  });

  test("lifts when the remaining findings no longer reach quarantine", () => {
    expect(shouldLift(true, "vulnerable", decide([finding({ severity: "high" })], new Set(), DEFAULT_ACTIONS))).toBe(true);
  });

  test("keeps the quarantine while the finding stands", () => {
    expect(shouldLift(true, "vulnerable", critical)).toBe(false);
  });

  test("never lifts on an error or an unsupported target", () => {
    expect(shouldLift(true, "error", clean)).toBe(false);
    expect(shouldLift(true, "unsupported", clean)).toBe(false);
  });

  test("does nothing when the server is not quarantined", () => {
    expect(shouldLift(false, "ok", clean)).toBe(false);
  });
});
