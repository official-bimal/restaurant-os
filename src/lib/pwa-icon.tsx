import { ImageResponse } from "next/og";

/**
 * The app icons, drawn on request (no image files to keep in step). A letter on a coloured tile: the staff app uses the "R" of the
 * Restaurant OS logo, and each restaurant's customer app uses the first letter of its own name.
 *
 * Two kinds: a normal icon with rounded corners, and a "maskable" one that fills the whole square, with the letter kept inside the
 * safe middle, because Android cuts its own shape (circle, squircle) out of it.
 */

export const ICON_SIZES = [180, 192, 512] as const;

export interface IconSpec {
  size: (typeof ICON_SIZES)[number];
  maskable: boolean;
}

/** "192", "512" or "maskable-512": what the icon address asks for. Anything else is not served. */
export function parseIconSpec(spec: string): IconSpec | null {
  const m = /^(maskable-)?(\d{3})$/.exec(spec);
  if (!m) return null;
  const size = Number(m[2]);
  if (!(ICON_SIZES as readonly number[]).includes(size)) return null;
  return { size: size as IconSpec["size"], maskable: !!m[1] };
}

/** The first letter that can stand for a name (a letter or digit, in any script), upper-cased. */
export function iconLetter(name: string): string {
  const first = [...name.trim()].find((ch) => /[\p{L}\p{N}]/u.test(ch));
  return (first ?? "R").toUpperCase();
}

export function drawIcon(p: { letter: string; spec: IconSpec; background: string; color?: string }): ImageResponse {
  const { size, maskable } = p.spec;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: p.background,
          color: p.color ?? "white",
          fontSize: Math.round(size * (maskable ? 0.46 : 0.62)),
          fontWeight: 700,
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        }}
      >
        {p.letter}
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
