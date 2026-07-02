/**
 * Content-based image type detection via magic bytes.
 *
 * Upload routes must not trust the client-declared Content-Type: an attacker
 * can label a script-bearing SVG (or HTML) as `image/png` and slip past a
 * mimetype allowlist. We positively identify only raster/photo formats by their
 * leading signature and reject everything else — notably SVG, which is XML text
 * with no binary magic and is dangerous because it executes script on top-level
 * navigation. The caller stores the *detected* type, never the client's claim.
 */

export const ALLOWED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

// ISO-BMFF (`ftyp`) major brands we treat as safe still-image containers.
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.toString("latin1", start, end);
}

/**
 * Returns the canonical MIME type detected from the buffer's magic bytes, or
 * `null` if the content is not a recognized raster image. Content-only — the
 * declared filename/mimetype are intentionally ignored.
 */
export function detectImageType(buf: Buffer): AllowedImageMime | null {
  if (!buf || buf.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  // GIF: "GIF87a" / "GIF89a"
  const gifHead = ascii(buf, 0, 6);
  if (gifHead === "GIF87a" || gifHead === "GIF89a") return "image/gif";

  // WebP: "RIFF" .... "WEBP"
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";

  // ISO-BMFF (HEIC / HEIF / AVIF): bytes 4..8 == "ftyp", brand at 8..12
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (AVIF_BRANDS.has(brand)) return "image/avif";
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }

  return null;
}
