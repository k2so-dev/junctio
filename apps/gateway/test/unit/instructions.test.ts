import { describe, expect, test } from "bun:test";
import { composeInstructions } from "../../src/aggregate/instructions.ts";

describe("composeInstructions", () => {
  test("returns undefined when nothing contributes", () => {
    expect(composeInstructions(null, [])).toBeUndefined();
    expect(composeInstructions("   ", [{ prefix: "a", text: null }])).toBeUndefined();
    expect(composeInstructions(undefined, [{ prefix: "a", text: "  " }])).toBeUndefined();
  });

  test("keeps the preamble alone when no server says anything", () => {
    expect(composeInstructions("Team stack.", [{ prefix: "a", text: undefined }])).toBe("Team stack.");
  });

  test("writes a section per server without a preamble", () => {
    expect(composeInstructions(null, [{ prefix: "a", text: "A text" }])).toBe("## a\n\nA text");
  });

  test("keeps the order and trims every part", () => {
    const composed = composeInstructions("  Team.  ", [
      { prefix: "a", text: " A text " },
      { prefix: "b", text: "B text" }
    ]);
    expect(composed).toBe("Team.\n\n## a\n\nA text\n\n## b\n\nB text");
  });

  test("skips blank sections between filled ones", () => {
    const composed = composeInstructions(null, [
      { prefix: "a", text: "A text" },
      { prefix: "skipped", text: "" },
      { prefix: "b", text: "B text" }
    ]);
    expect(composed).toBe("## a\n\nA text\n\n## b\n\nB text");
  });
});
