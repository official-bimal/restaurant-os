import { requireTenant } from "@/server/auth";
import { can, canManageRole } from "@/server/permissions";
import { listBranches } from "@/features/branches/server/service";
import { setStaffBranchesAction } from "../branches/actions";
import { listStaff, ROLES } from "@/features/staff/server/service";
import { changeRoleAction, removeStaffAction } from "./actions";
import { CreateStaffForm, ResetPasswordButton } from "./secret-box";

export const dynamic = "force-dynamic";

const smallBtn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";
const LABEL: Record<string, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  WAITER: "Waiter",
  KITCHEN: "Kitchen",
  RIDER: "Rider",
  ACCOUNTANT: "Accountant",
};

export default async function StaffPage({ searchParams }: PageProps<"/staff">) {
  const ctx = await requireTenant("staff.manage");
  const { error } = await searchParams;
  const staff = await listStaff(ctx);
  const canBranches = can(ctx.role, "branch.manage");
  const branches = canBranches ? (await listBranches(ctx)).filter((b) => b.active) : [];
  const assignable = ROLES.filter((r) => canManageRole(ctx.role, r)).map((r) => ({ value: r, label: LABEL[r] }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Staff</h1>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <CreateStaffForm roles={assignable} />

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="mb-2 font-semibold">Team ({staff.length})</h2>
        <ul className="divide-y divide-stone-100">
          {staff.map((m) => {
            const self = m.userId === ctx.userId;
            const manageable = !self && canManageRole(ctx.role, m.role);
            return (
              <li key={m.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {m.user.name} {self && <span className="text-xs font-normal text-stone-500">(you)</span>}
                  </p>
                  <p className="text-sm text-stone-500">{m.user.email}</p>
                  {branches.length > 1 && (
                    <p className="text-xs text-stone-500">
                      Branches:{" "}
                      {m.allBranches
                        ? "all"
                        : branches.filter((b) => m.branches.some((x) => x.branchId === b.id)).map((b) => b.name).join(", ") || "none"}
                    </p>
                  )}
                  {m.user.mustChangePassword && (
                    <p className="text-xs text-amber-700">Has not chosen their own password yet</p>
                  )}
                </div>

                {manageable ? (
                  <>
                    <form action={changeRoleAction.bind(null, m.id)} className="flex items-center gap-2">
                      <select
                        name="role"
                        defaultValue={m.role}
                        aria-label={`Role for ${m.user.name}`}
                        className="rounded-lg border border-stone-300 px-2 py-2 text-sm"
                      >
                        {assignable.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <button className={smallBtn}>Save role</button>
                    </form>
                    <ResetPasswordButton membershipId={m.id} name={m.user.name} />
                    {canBranches && branches.length > 1 && (
                      <details>
                        <summary className={`${smallBtn} flex cursor-pointer items-center`}>Branches</summary>
                        <form action={setStaffBranchesAction.bind(null, m.id)} className="mt-2 space-y-2 rounded-lg bg-stone-50 p-3 text-sm">
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="all" defaultChecked={m.allBranches} /> All branches
                          </label>
                          {branches.map((b) => (
                            <label key={b.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                name="branch"
                                value={b.id}
                                defaultChecked={m.branches.some((x) => x.branchId === b.id)}
                              />{" "}
                              {b.name}
                            </label>
                          ))}
                          <p className="text-xs text-stone-500">Ticking &ldquo;All branches&rdquo; ignores the ticks below.</p>
                          <button className="min-h-9 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 text-white">Save access</button>
                        </form>
                      </details>
                    )}
                    <details>
                      <summary className={`${smallBtn} flex cursor-pointer items-center text-red-700`}>Remove</summary>
                      <form action={removeStaffAction.bind(null, m.id)} className="mt-2 rounded-lg bg-red-50 p-3 text-sm">
                        <p>{m.user.name} will lose access immediately.</p>
                        <button className="mt-2 min-h-9 rounded-lg bg-red-700 px-3 text-white">Yes, remove</button>
                      </form>
                    </details>
                  </>
                ) : (
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-sm">{LABEL[m.role]}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
