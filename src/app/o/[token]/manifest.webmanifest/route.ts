import { customerManifest } from "@/features/online/manifest";
import { lookupBranch } from "@/features/online/server/service";

/** This restaurant's customer app: what the phone reads when the ordering page is added to the home screen. Public, like the page. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const branch = await lookupBranch(token);
  if (!branch) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(customerManifest({ token, businessName: branch.businessName, branchName: branch.branchName })), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
