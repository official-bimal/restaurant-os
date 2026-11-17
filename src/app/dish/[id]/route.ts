import type { NextRequest } from "next/server";
import { getDishImage } from "@/features/menu/server/images";

/**
 * A dish's photo, for the guest menu (no sign-in needed: the photo is public on the menu). The page adds ?v=<time> to the
 * address, so a changed photo gets a new address and the old one can be cached for a long time.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/dish/[id]">) {
  const { id } = await ctx.params;
  const img = await getDishImage(id);
  if (!img) return new Response("Not found", { status: 404 });
  const etag = `"${img.updatedAt.getTime()}"`;
  const headers = {
    "Content-Type": img.contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    // Never let the browser guess a different type for what was uploaded, and never run it as a page.
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ETag: etag,
  };
  if (_request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(img.data), { headers });
}

export const dynamic = "force-dynamic";
