import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { freePort, seedHttpServer, startHarness, type Harness } from "../helpers.ts";
import { UpstreamError } from "../../src/upstream/types.ts";

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.stop();
});

async function seedDeadUpstream(): Promise<string> {
  const port = await freePort();
  return seedHttpServer(harness.core, { name: "dead", url: `http://127.0.0.1:${port}/mcp` });
}

describe("remote upstream backoff", () => {
  test("refuses to reconnect while the backoff window is open", async () => {
    const id = await seedDeadUpstream();

    await expect(harness.core.pool.acquire(id)).rejects.toThrow();
    const firstError = harness.core.pool.getLastError(id);
    expect(firstError).toBeTruthy();

    const blocked = await harness.core.pool.acquire(id).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(UpstreamError);
    expect((blocked as UpstreamError).code).toBe("backoff");
    expect((blocked as UpstreamError).message).toBe(String(firstError));
  });

  test("an explicit invalidate clears the backoff", async () => {
    const id = await seedDeadUpstream();

    await expect(harness.core.pool.acquire(id)).rejects.toThrow();
    await harness.core.pool.invalidate(id, "restarted from the api");

    const retried = await harness.core.pool.acquire(id).catch((error: unknown) => error);
    expect(retried).toBeInstanceOf(Error);
    expect((retried as UpstreamError).code).not.toBe("backoff");
  });

  test("safeCatalog stays quiet while backing off", async () => {
    const id = await seedDeadUpstream();

    await expect(harness.core.pool.acquire(id)).rejects.toThrow();
    const catalog = await harness.core.pool.safeCatalog(id);
    expect(catalog.tools).toEqual([]);
  });
});
