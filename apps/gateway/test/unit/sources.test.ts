import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import catalog from "../../../web/src/data/sources.json" with { type: "json" };
import { SourceCatalog } from "@junctio/schema";

const parsed = SourceCatalog.parse(catalog);
const iconDir = join(import.meta.dir, "..", "..", "..", "web", "public", "sources");

describe("source catalog", () => {
  test("every entry matches the schema", () => {
    expect(parsed.sources.length).toBeGreaterThan(20);
  });

  test("ids and urls are unique", () => {
    const ids = parsed.sources.map((source) => source.id);
    const urls = parsed.sources.map((source) => source.url);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  test("the host of an entry belongs to its url", () => {
    for (const source of parsed.sources) {
      const url = new URL(source.url);
      const shown = `${url.hostname}${url.pathname}`.replace(/\/$/, "");
      expect(shown.endsWith(source.host) || shown.replace(/^www\./, "").startsWith(source.host)).toBe(true);
    }
  });

  test("every icon it names is in the repository", () => {
    for (const source of parsed.sources) {
      if (source.icon === null) continue;
      expect(existsSync(join(iconDir, source.icon))).toBe(true);
    }
  });

  test("every group holds at least one entry", () => {
    const groups = new Set(parsed.sources.map((source) => source.group));
    expect([...groups].sort()).toEqual(["api", "canonical", "catalogs", "regional", "vendors"]);
  });
});
