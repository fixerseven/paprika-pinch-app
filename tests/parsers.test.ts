import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvObjects } from "@/lib/import/csv";
import { parseCaptionFile } from "@/lib/import/captions";
import { localToUtc, addDays, todayIn } from "@/lib/time";
import { safeRelPath } from "@/lib/import/queue";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and CRLF", () => {
    const rows = parseCsv('a,b,c\r\n1,"two, 2","say ""hi"""\r\n');
    expect(rows).toEqual([["a", "b", "c"], ["1", "two, 2", 'say "hi"']]);
  });
  it("keeps empty cells and objects by header", () => {
    expect(parseCsvObjects("x,y,z\n1,,3\n")).toEqual([{ x: "1", y: "", z: "3" }]);
  });
  it("handles newlines inside quotes", () => {
    expect(parseCsv('a\n"line1\nline2"\n')).toEqual([["a"], ["line1\nline2"]]);
  });
});

describe("parseCaptionFile", () => {
  it("splits sections and drops note lines", () => {
    const map = parseCaptionFile("# Title\n\n---\n\n## B13\n**note**  \nStatus: ready.\n\nHello.\n#Tag\n\n---\n\n## B14\nSecond.\n");
    expect(map.get("B13")).toBe("Hello.\n#Tag");
    expect(map.get("B14")).toBe("Second.");
  });
});

describe("time", () => {
  it("converts Manila wall time to UTC", () => {
    expect(localToUtc("2026-11-18", "19:00", "Asia/Manila")).toBe("2026-11-18T11:00:00.000Z");
    expect(localToUtc("2026-11-16", "08:00", "Asia/Manila")).toBe("2026-11-16T00:00:00.000Z");
  });
  it("handles daylight saving zones", () => {
    expect(localToUtc("2026-07-01", "12:00", "America/New_York")).toBe("2026-07-01T16:00:00.000Z");
    expect(localToUtc("2026-12-01", "12:00", "America/New_York")).toBe("2026-12-01T17:00:00.000Z");
  });
  it("adds days and finds today in a zone", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(todayIn("Asia/Manila", new Date("2026-11-16T17:00:00Z"))).toBe("2026-11-17");
  });
});

describe("safeRelPath", () => {
  it("rejects paths that leave the brand folder", () => {
    expect(safeRelPath("Posts/x.png")).toBe(true);
    expect(safeRelPath("../Nest Workspaces/x.png")).toBe(false);
    expect(safeRelPath("/etc/passwd")).toBe(false);
    expect(safeRelPath("C:\\x.png")).toBe(false);
  });
});

describe("real queue row shapes", () => {
  it("parses a title that starts with a quoted line and a multi-sentence quoted note", () => {
    const csv =
      'date,time,track,post_id,title,feed_file,story_file,reel_file,caption_file,status,owner,notes\r\n' +
      '2026-11-03,19:00,Owners,A2-06,"""Boss, ok na?"" How many times did you read that today?",Posts/f.png,Posts/s.png,,Posts/C.md#A2-06,ready,content,Nov 2026 Slot 2 · Sound familiar?. Approved by Nath 2026-10-28.\r\n' +
      '2026-11-15,12:00,Both,B20,Carousel,a.png;b.png,,,C.md#B20,"dropped: early draft image, replaced by P-NW2 (Nov 10)",promo,\r\n';
    const [a, b] = parseCsvObjects(csv);
    expect(a.title).toBe('"Boss, ok na?" How many times did you read that today?');
    expect(a.notes).toContain("Sound familiar?.");
    expect(b.feed_file).toBe("a.png;b.png");
    expect(b.status).toBe("dropped: early draft image, replaced by P-NW2 (Nov 10)");
  });
});
