/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { toCsv, downloadCsv } from "../src/lib/csv-export.js";

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

  it("neutralizes spreadsheet formula injection by prefixing a single quote", () => {
    // Leading = + - @ tab CR are dangerous in Excel/Sheets; each is prefixed with '.
    const csv = toCsv(["room"], [["=SUM(A1:A9)"], ["+1"], ["-1"], ["@cmd"], ["safe"]]);
    expect(csv).toBe("room\r\n'=SUM(A1:A9)\r\n'+1\r\n'-1\r\n'@cmd\r\nsafe");
  });

  it("quotes a formula-guarded cell that also needs RFC-4180 quoting", () => {
    // "=a,b" → guard to "'=a,b" → contains a comma → quoted.
    expect(toCsv(["x"], [["=a,b"]])).toBe('x\r\n"\'=a,b"');
  });
});

describe("downloadCsv", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a text/csv blob, clicks a download anchor, and revokes the URL", () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    // happy-dom may not implement these — install spies.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;

    const click = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === "a") (el as HTMLAnchorElement).click = click;
      return el;
    });

    downloadCsv("report.csv", "a,b\r\n1,2");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain("text/csv");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});
