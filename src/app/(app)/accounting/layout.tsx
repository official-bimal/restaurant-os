import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { AccountingNav } from "./accounting-nav";

/** Every Accounts page sits beside the same grouped menu. */
export default async function AccountingLayout({ children }: LayoutProps<"/accounting">) {
  const ctx = await requireTenant("books.view");
  return (
    <div className="lg:flex lg:gap-8">
      <AccountingNav canManage={can(ctx, "books.manage")} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
