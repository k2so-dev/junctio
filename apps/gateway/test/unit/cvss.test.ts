import { describe, expect, test } from "bun:test";
import { cvssBaseScore } from "../../src/audit/cvss.ts";

describe("cvss base score", () => {
  test("scores a critical network vector", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
  });

  test("scores a changed scope vector", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N")).toBe(6.1);
  });

  test("scores a low severity vector", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N")).toBe(1.8);
  });

  test("returns zero when nothing is impacted", () => {
    expect(cvssBaseScore("CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")).toBe(0);
  });

  test("rejects a version it does not implement", () => {
    expect(cvssBaseScore("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H")).toBeNull();
    expect(cvssBaseScore("CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P")).toBeNull();
  });

  test("rejects a malformed vector", () => {
    expect(cvssBaseScore("not a vector")).toBeNull();
    expect(cvssBaseScore("CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBeNull();
  });
});
