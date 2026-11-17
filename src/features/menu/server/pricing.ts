import { db } from "@/server/db";
import type { Tx } from "@/server/audit";
import { resolveAddOns, type AddOnGroupRule } from "@/features/menu/addons";
import { branchAddOnOverrides } from "@/features/menu/server/branch-menu";

type Db = Tx | typeof db;

/**
 * Add-on lookups shared by the waiter's order screen, the guest's phone menu and the accept
 * step, so all three price a dish the same way. Every query is filtered by businessId.
 */

type LinkRow = {
  menuItemId: string;
  group: {
    id: string;
    name: string;
    required: boolean;
    multiple: boolean;
    addOns: { id: string; name: string; price: number }[];
  };
};

const GROUP_INCLUDE = {
  group: { include: { addOns: { where: { active: true }, orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }] } } },
};

type AddOnOverrides = Map<string, { price: number | null; available: boolean }>;

/** Turn links into rules, applying a branch's add-on overrides (its own price; choices it has switched off are dropped). */
function toRules(links: LinkRow[], overrides?: AddOnOverrides): AddOnGroupRule[] {
  return links
    .map((l) => ({
      id: l.group.id,
      name: l.group.name,
      required: l.group.required,
      multiple: l.group.multiple,
      choices: l.group.addOns
        .filter((a) => overrides?.get(a.id)?.available !== false)
        .map((a) => ({ id: a.id, name: a.name, price: overrides?.get(a.id)?.price ?? a.price })),
    }))
    .filter((g) => g.choices.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The active groups (with their active choices) a dish offers. */
export async function groupRulesForItem(client: Db, businessId: string, menuItemId: string, branchId?: string): Promise<AddOnGroupRule[]> {
  const [links, overrides] = await Promise.all([
    client.menuItemAddOnGroup.findMany({ where: { businessId, menuItemId, group: { active: true } }, include: GROUP_INCLUDE }),
    branchId ? branchAddOnOverrides(client, businessId, branchId) : undefined,
  ]);
  return toRules(links, overrides);
}

/** Check a set of picked choices against what the dish offers, and price them. Throws a DomainError if they do not fit. */
export async function priceAddOns(client: Db, businessId: string, menuItemId: string, addOnIds: string[], branchId?: string) {
  return resolveAddOns(await groupRulesForItem(client, businessId, menuItemId, branchId), addOnIds);
}

/** What every dish offers, for drawing a menu: dish id to its groups. */
export async function groupRulesForMenu(client: Db, businessId: string, branchId?: string): Promise<Map<string, AddOnGroupRule[]>> {
  const [links, overrides] = await Promise.all([
    client.menuItemAddOnGroup.findMany({ where: { businessId, group: { active: true } }, include: GROUP_INCLUDE }),
    branchId ? branchAddOnOverrides(client, businessId, branchId) : undefined,
  ]);
  const byItem = new Map<string, LinkRow[]>();
  for (const l of links) byItem.set(l.menuItemId, [...(byItem.get(l.menuItemId) ?? []), l]);
  return new Map([...byItem].map(([id, rows]) => [id, toRules(rows, overrides)] as const).filter(([, rules]) => rules.length > 0));
}

/** Names for a set of add-on ids (archived ones too), so old orders and carts still read properly. */
export async function addOnNames(client: Db, businessId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await client.addOn.findMany({ where: { businessId, id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}
