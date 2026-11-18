import type { Metadata } from "next";
import { getOnlineMenu, lookupBranch } from "@/features/online/server/service";
import { prepMessage } from "@/features/online/rules";
import { formatNpr } from "@/features/billing/calc";
import { LangSwitch } from "@/app/t/[token]/lang";
import { OnlineMenu } from "./online-menu";

export const dynamic = "force-dynamic";

// The token in the URL is the link the restaurant shares; keep it out of Referer headers. The page itself may be found.
export const metadata: Metadata = {
  title: "Order online",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="guest-dark min-h-screen">
      <div className="mx-auto max-w-lg p-4">
        <LangSwitch />
        {children}
      </div>
    </main>
  );
}

export default async function OnlineOrderPage({ params }: PageProps<"/o/[token]">) {
  const { token } = await params;
  const branch = await lookupBranch(token);
  if (!branch) {
    return (
      <Shell>
        <h1 className="mt-4 text-xl font-semibold">This ordering link is not valid</h1>
        <p className="mt-2 text-stone-600">Please ask the restaurant for their current link.</p>
      </Shell>
    );
  }
  if (!branch.enabled) {
    return (
      <Shell>
        <h1 className="mt-4 text-2xl font-semibold">{branch.businessName}</h1>
        <p className="mt-2 text-stone-600">Online ordering is not available right now. Please call us or visit.</p>
      </Shell>
    );
  }
  const menu = await getOnlineMenu(branch);
  const how = [branch.pickup && "pickup", branch.delivery && "delivery"].filter(Boolean).join(" and ");

  return (
    <Shell>
      <header className="mb-4 mt-2">
        <h1 className="text-2xl font-semibold">{branch.businessName}</h1>
        <p className="text-stone-600">
          {branch.branchName} · order for {how}
        </p>
        <p className="mt-1 text-sm text-stone-500">{prepMessage(branch.prepMinutes, branch.pickup ? "TAKEAWAY" : "DELIVERY")}</p>
        {branch.minOrder > 0 && <p className="text-sm text-stone-500">Minimum order {formatNpr(branch.minOrder)}.</p>}
        {branch.notice && (
          <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {branch.notice}
          </p>
        )}
      </header>
      {menu.length === 0 ? (
        <p className="py-10 text-center text-stone-500">Nothing is available to order right now.</p>
      ) : (
        <OnlineMenu
          token={token}
          categories={menu.map((c) => ({ id: c.id, name: c.name, nameNe: c.nameNe, items: c.items }))}
          branch={{ pickup: branch.pickup, delivery: branch.delivery, minOrder: branch.minOrder, prepMinutes: branch.prepMinutes, zones: branch.zones, byDistance: branch.byDistance }}
        />
      )}
    </Shell>
  );
}
