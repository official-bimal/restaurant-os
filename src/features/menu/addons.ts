import { DomainError } from "@/server/errors";

/**
 * Add-on rules, kept pure so they can be tested without a database.
 * Money is integer paisa. A line's unit price is the dish price plus every chosen add-on.
 */

export interface AddOnChoice {
  id: string;
  name: string;
  price: number;
}
export interface AddOnGroupRule {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  choices: AddOnChoice[];
}

export function resolveAddOns(groups: AddOnGroupRule[], chosenIds: string[]): { chosen: AddOnChoice[]; extra: number } {
  const ids = [...new Set(chosenIds)];
  const byId = new Map<string, { choice: AddOnChoice; group: AddOnGroupRule }>();
  for (const g of groups) for (const c of g.choices) byId.set(c.id, { choice: c, group: g });

  const perGroup = new Map<string, AddOnChoice[]>();
  for (const id of ids) {
    const hit = byId.get(id);
    if (!hit) throw new DomainError("One of those options is not available for this dish.");
    perGroup.set(hit.group.id, [...(perGroup.get(hit.group.id) ?? []), hit.choice]);
  }

  for (const g of groups) {
    const picked = perGroup.get(g.id) ?? [];
    if (g.required && picked.length === 0) throw new DomainError(`Choose an option for ${g.name}.`);
    if (!g.multiple && picked.length > 1) throw new DomainError(`Choose only one option for ${g.name}.`);
  }

  // Keep the groups' own order so tickets and bills read the same every time.
  const chosen = groups.flatMap((g) => perGroup.get(g.id) ?? []);
  return { chosen, extra: chosen.reduce((n, c) => n + c.price, 0) };
}

export function validateAddOnPrice(price: number) {
  if (!Number.isInteger(price) || price < 0 || price > 10_000_000) {
    throw new DomainError("Enter an extra price of Rs 0 or more.");
  }
}
