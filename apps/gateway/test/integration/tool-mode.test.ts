import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_FOLDER } from "../../src/db/index.ts";
import { adminApi, startHarness, type Harness } from "../helpers.ts";

let harness: Harness;
const api = adminApi(() => harness);

beforeEach(async () => {
  harness = await startHarness();
  await api("/v1/session/setup", { method: "POST", body: JSON.stringify({ password: "supersecret" }) });
});

afterEach(async () => {
  await harness.stop();
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function namespaceId(): Promise<string> {
  const namespace = await json<{ id: string }>(
    await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
  );
  return namespace.id;
}

async function createEndpoint(body: Record<string, unknown>) {
  return json<{ id: string; toolMode: string }>(
    await api("/v1/endpoints", { method: "POST", body: JSON.stringify(body) })
  );
}

describe("tool mode settings", () => {
  test("a new install creates compact endpoints and the default can be changed", async () => {
    const settings = await json<{ defaultToolMode: string }>(await api("/v1/settings"));
    expect(settings.defaultToolMode).toBe("compact");
    const namespace = await namespaceId();

    const first = await createEndpoint({ slug: "first", namespaceId: namespace });
    expect(first.toolMode).toBe("compact");

    const patched = await json<{ toolMode: string }>(
      await api(`/v1/endpoints/${first.id}`, { method: "PATCH", body: JSON.stringify({ toolMode: "full" }) })
    );
    expect(patched.toolMode).toBe("full");

    await api("/v1/settings", { method: "PATCH", body: JSON.stringify({ defaultToolMode: "full" }) });
    expect((await createEndpoint({ slug: "second", namespaceId: namespace })).toolMode).toBe("full");
    expect((await createEndpoint({ slug: "third", namespaceId: namespace, toolMode: "compact" })).toolMode).toBe(
      "compact"
    );

    const invalid = await api("/v1/endpoints", {
      method: "POST",
      body: JSON.stringify({ slug: "fourth", namespaceId: namespace, toolMode: "tiny" })
    });
    expect(invalid.status).toBe(400);
  });
});

describe("tool mode migration", () => {
  const files = readdirSync(MIGRATIONS_FOLDER)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const target = files.findIndex((file) => readFileSync(join(MIGRATIONS_FOLDER, file), "utf8").includes("tool_mode"));

  function apply(db: Database, selected: string[]): void {
    for (const file of selected) {
      for (const statement of readFileSync(join(MIGRATIONS_FOLDER, file), "utf8").split("--> statement-breakpoint")) {
        if (statement.trim() !== "") db.run(statement);
      }
    }
  }

  test("an upgraded install keeps its endpoints and new ones in full mode", () => {
    expect(target).toBeGreaterThan(0);
    const db = new Database(":memory:");
    apply(db, files.slice(0, target));
    db.run("INSERT INTO settings (key, value) VALUES ('gateway_id', 'gw')");
    db.run("INSERT INTO namespaces (id, name, created_at) VALUES ('ns', 'team', 0)");
    db.run("INSERT INTO endpoints (id, slug, namespace_id, created_at) VALUES ('ep', 'team', 'ns', 0)");
    apply(db, files.slice(target));
    expect(db.query("SELECT tool_mode FROM endpoints").get()).toEqual({ tool_mode: "full" });
    expect(db.query("SELECT value FROM settings WHERE key = 'default_tool_mode'").get()).toEqual({ value: "full" });
  });

  test("a fresh install gets no stored default, so compact applies", () => {
    const db = new Database(":memory:");
    apply(db, files);
    expect(db.query("SELECT value FROM settings WHERE key = 'default_tool_mode'").get()).toBeNull();
  });
});
