/**
 * Dish photos. The browser shrinks a picture before uploading it, but the server never trusts that: it looks at the
 * first bytes of the file itself and accepts only JPEG, PNG and WebP (never SVG, which can carry scripts).
 */

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** The biggest photo the server will keep, after the browser has shrunk it. */
export const MAX_IMAGE_BYTES = 600_000;

export function detectImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  // WebP is "RIFF", four size bytes, then "WEBP".
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
