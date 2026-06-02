import { describe, expect, it } from "vitest";
import {
  decodeCapgoNdefRecords,
  encodeCapgoNdefUrlRecord,
  tagIdHexFromCapgoId,
} from "@/lib/nfc-capgo-decode";

describe("nfc-capgo-decode", () => {
  it("encodes and decodes URL records", () => {
    const url = "https://vettrack.uk/equipment/abc?nfcAction=toggle";
    const record = encodeCapgoNdefUrlRecord(url);
    const { url: decoded } = decodeCapgoNdefRecords([record]);
    expect(decoded).toBe(url);
  });

  it("maps tag UID bytes to hex", () => {
    expect(tagIdHexFromCapgoId([0x04, 0xa1, 0xff])).toBe("04a1ff");
  });

  it("includes tagId on decode when provided", () => {
    const payload = decodeCapgoNdefRecords([], "deadbeef");
    expect(payload.tagId).toBe("deadbeef");
  });
});
