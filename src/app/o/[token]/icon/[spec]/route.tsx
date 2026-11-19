import { drawIcon, iconLetter, parseIconSpec } from "@/lib/pwa-icon";
import { lookupBranch } from "@/features/online/server/service";

/** A restaurant's customer-app icon: the first letter of its name on the ordering page's orange. Only for a real, valid link. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; spec: string }> }) {
  const { token, spec } = await ctx.params;
  const parsed = parseIconSpec(spec);
  const branch = parsed ? await lookupBranch(token) : null;
  if (!parsed || !branch) return new Response("Not found", { status: 404 });
  return drawIcon({ letter: iconLetter(branch.businessName), spec: parsed, background: "#f4613b" });
}
