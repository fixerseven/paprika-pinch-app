import { describe, expect, it } from "vitest";
import { loudFlags, shortDay } from "../src/lib/labels";

describe("loudFlags", () => {
  it("keeps only flags that need a look, with their tone", () => {
    const out = loudFlags([
      { code: "fb_story_manual", text: "Facebook story is manual" },
      { code: "check_fact", text: "Check this fact today" },
      { code: "missing_media", text: "feed file not found" },
      { code: "off_slot", text: "13:00 isn't one of the usual slots" },
    ]);
    expect(out.map((f) => [f.code, f.tone])).toEqual([
      ["check_fact", "due"],
      ["missing_media", "bad"],
    ]);
  });
});

describe("shortDay", () => {
  it("formats a date as weekday, day and month", () => {
    expect(shortDay("2026-11-27")).toBe("Fri 27 Nov");
  });
});
