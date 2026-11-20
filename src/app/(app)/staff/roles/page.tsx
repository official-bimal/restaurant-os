import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { basePermissions } from "@/server/permissions";
import { listRoles } from "@/features/staff/server/roles";
import { BASE_ROLES, GRANTABLE, PERMISSION_GROUPS, ROLE_COLORS } from "@/features/staff/roles";
import { deleteRoleAction, saveRoleAction } from "./actions";
import { RoleDot, RoleForm } from "./role-form";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { MANAGER: "Manager", CASHIER: "Cashier", WAITER: "Waiter", KITCHEN: "Kitchen", RIDER: "Rider", ACCOUNTANT: "Accountant" };

export default async function RolesPage({ searchParams }: PageProps<"/staff/roles">) {
  const ctx = await requireTenant("owner.control");
  const sp = await searchParams;
  const roles = await listRoles(ctx);
  const matrix: Record<string, string[]> = Object.fromEntries(BASE_ROLES.map((r) => [r, basePermissions(r).filter((p) => GRANTABLE.includes(p))]));
  const bases = BASE_ROLES.map((r) => ({ value: r, label: LABEL[r] ?? r }));
  const common = { groups: PERMISSION_GROUPS, colors: [...ROLE_COLORS], bases, matrix };
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/staff" className="text-sm text-stone-500 hover:underline">
          ← Staff
        </Link>
        <h1 className="text-2xl font-semibold">Roles</h1>
      </div>
      <p className="text-sm text-stone-600">
        Make your own roles, such as &ldquo;Shift lead&rdquo; or &ldquo;Bar head&rdquo;, and tick exactly what each may do. Give a role to someone on the Staff page. Owner powers and managing staff stay with built-in owners and managers and cannot be given
        through a role.
      </p>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      {sp.saved === "1" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>}

      {roles.map((r) => (
        <details key={r.id} className="card p-4">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2">
            <RoleDot color={r.color} />
            <span className="font-semibold">{r.name}</span>
            <span className="text-sm text-stone-500">
              works like a {LABEL[r.baseRole]?.toLowerCase()} · {r.permissions.length} permissions · {r.people} {r.people === 1 ? "person" : "people"}
            </span>
          </summary>
          <div className="mt-4 space-y-3">
            <RoleForm {...common} action={saveRoleAction.bind(null, r.id)} initial={{ name: r.name, color: r.color, baseRole: r.baseRole, permissions: r.permissions }} submitLabel="Save role" />
            <form action={deleteRoleAction.bind(null, r.id)}>
              <button className="text-sm text-red-700 hover:underline">Delete this role{r.people > 0 ? ` (${r.people} will go back to ${LABEL[r.baseRole]?.toLowerCase()})` : ""}</button>
            </form>
          </div>
        </details>
      ))}

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">New role</h2>
        <RoleForm {...common} action={saveRoleAction.bind(null, null)} initial={{ name: "", color: "indigo", baseRole: "WAITER", permissions: matrix.WAITER ?? [] }} submitLabel="Make role" />
      </section>
    </div>
  );
}
