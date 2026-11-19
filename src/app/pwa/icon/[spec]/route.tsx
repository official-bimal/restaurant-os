import { drawIcon, parseIconSpec } from "@/lib/pwa-icon";

/** The staff app's icons: /pwa/icon/192, /pwa/icon/512 and /pwa/icon/maskable-512. The teal tile and "R" of the logo. */
export async function GET(_req: Request, ctx: { params: Promise<{ spec: string }> }) {
  const { spec } = await ctx.params;
  const parsed = parseIconSpec(spec);
  if (!parsed) return new Response("Not found", { status: 404 });
  return drawIcon({ letter: "R", spec: parsed, background: "#0f857a" });
}
