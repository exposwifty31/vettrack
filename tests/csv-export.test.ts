import { describe, it, expect } from "vitest";
import { toCsv } from "../src/lib/csv-export.js";

describe("toCsv (RFC-4180)", () => {
  it("joins headers + rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, 2], [3, 4]])).toBe("a,b\r\n1,2\r\n3,4");
  });

  it("quotes cells containing comma, quote, or newline and doubles inner quotes", () => {
    const csv = toCsv(["name", "note"], [["Smith, Jr.", 'say "hi"'], ["multi", "line\nbreak"]]);
    // "multi" has no special chars → left unquoted (RFC-4180 only quotes when needed).
    expect(csv).toBe('name,note\r\n"Smith, Jr.","say ""hi"""\r\nmulti,"line\nbreak"');
  });

  it("renders null/undefined as empty cells", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, "x"]])).toBe("a,b,c\r\n,,x");
  });
});
