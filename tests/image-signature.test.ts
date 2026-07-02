import { describe, it, expect } from "vitest";
import { detectImageType } from "../server/lib/image-signature.js";

/** Build an ISO-BMFF header: [size][ftyp][brand] + padding. */
function ftyp(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftyp", "latin1"),
    Buffer.from(brand, "latin1"),
    Buffer.from("mif1", "latin1"),
  ]);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const GIF89 = Buffer.from("GIF89a" + "\x01\x00\x01\x00\x00\x00", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "latin1")]);

describe("detectImageType — magic-byte content detection", () => {
  it("detects the allowed raster formats by content", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(GIF89)).toBe("image/gif");
    expect(detectImageType(Buffer.from("GIF87a" + "......", "latin1"))).toBe("image/gif");
    expect(detectImageType(WEBP)).toBe("image/webp");
    expect(detectImageType(ftyp("heic"))).toBe("image/heic");
    expect(detectImageType(ftyp("avif"))).toBe("image/avif");
    expect(detectImageType(ftyp("mif1"))).toBe("image/heif");
  });

  it("rejects SVG regardless of how it is framed (the core vector)", () => {
    expect(detectImageType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'))).toBeNull();
    // Leading whitespace/BOM before <svg> — still not a raster signature.
    expect(detectImageType(Buffer.from("﻿   <svg width='1'></svg>"))).toBeNull();
  });

  it("rejects HTML and other non-image payloads", () => {
    expect(detectImageType(Buffer.from("<!DOCTYPE html><script>alert(1)</script>"))).toBeNull();
    expect(detectImageType(Buffer.from("GIF but not really a header here"))).toBeNull();
    expect(detectImageType(Buffer.from("RIFF____NOTWEBP__", "latin1"))).toBeNull();
    expect(detectImageType(ftyp("qt  "))).toBeNull(); // a real video ftyp brand
  });

  it("rejects empty / too-short buffers without throwing", () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
    // @ts-expect-error — guards against a null buffer at the boundary
    expect(detectImageType(null)).toBeNull();
  });

  it("is content-only: a PNG stays a PNG no matter what it was named", () => {
    // Same PNG bytes an attacker might upload as "logo.svg" with type image/svg+xml.
    expect(detectImageType(PNG)).toBe("image/png");
  });
});
