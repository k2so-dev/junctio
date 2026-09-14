import { describe, expect, test } from "bun:test";
import {
  assertUniquePrefixes,
  assertUniqueToolNames,
  CollisionError,
  exposedToolName,
  exposedUri,
  splitToolName,
  splitUri,
  uriPrefix
} from "../../src/aggregate/naming.ts";

describe("tool naming", () => {
  test("prefixes a tool", () => {
    expect(exposedToolName("linear", "create_issue", "__")).toBe("linear__create_issue");
  });

  test("splits a prefixed tool", () => {
    expect(splitToolName("linear__create_issue", "__")).toEqual({ prefix: "linear", tool: "create_issue" });
  });

  test("splits on the first separator only", () => {
    expect(splitToolName("a__b__c", "__")).toEqual({ prefix: "a", tool: "b__c" });
  });

  test("rejects names without a separator", () => {
    expect(splitToolName("plain", "__")).toBeNull();
    expect(splitToolName("__leading", "__")).toBeNull();
    expect(splitToolName("trailing__", "__")).toBeNull();
  });

  test("supports a custom separator", () => {
    expect(splitToolName("a.b", ".")).toEqual({ prefix: "a", tool: "b" });
  });
});

describe("resource uri naming", () => {
  test("prefixes a uri with a parseable scheme", () => {
    const exposed = exposedUri("my_srv", "mock://readme");
    expect(exposed).toBe("my-srv+mock://readme");
    expect(() => new URL(exposed)).not.toThrow();
  });

  test("round trips a uri", () => {
    const exposed = exposedUri("linear", "file:///a/b.txt");
    expect(splitUri(exposed)).toEqual({ prefix: "linear", uri: "file:///a/b.txt" });
  });

  test("lowercases and dashes the prefix", () => {
    expect(uriPrefix("My_Server")).toBe("my-server");
  });
});

describe("collision detection", () => {
  test("accepts distinct prefixes", () => {
    expect(() =>
      assertUniquePrefixes([
        { serverId: "1", serverName: "a", prefix: "a" },
        { serverId: "2", serverName: "b", prefix: "b" }
      ])
    ).not.toThrow();
  });

  test("rejects duplicate prefixes", () => {
    expect(() =>
      assertUniquePrefixes([
        { serverId: "1", serverName: "a", prefix: "same" },
        { serverId: "2", serverName: "b", prefix: "same" }
      ])
    ).toThrow(CollisionError);
  });

  test("rejects prefixes that collide as uri schemes", () => {
    expect(() =>
      assertUniquePrefixes([
        { serverId: "1", serverName: "a", prefix: "my_srv" },
        { serverId: "2", serverName: "b", prefix: "my-srv" }
      ])
    ).toThrow(/resource uris/);
  });

  test("rejects duplicate exposed tool names", () => {
    expect(() =>
      assertUniqueToolNames([
        { exposed: "a__x", serverName: "a" },
        { exposed: "a__x", serverName: "b" }
      ])
    ).toThrow(/exposed by both/);
  });
});
