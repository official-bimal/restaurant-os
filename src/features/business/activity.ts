/** Pure: turns an audit action code ("menu.item.delete") into words an owner reads. */

const WORDS: Record<string, string> = {
  "menu.item.delete": "Deleted a dish",
  "menu.item.availability": "Changed a dish's availability",
  "menu.item.photo": "Set a dish photo",
  "menu.item.photoRemove": "Removed a dish photo",
  "business.profile": "Changed the business profile",
  "business.logo": "Changed the logo",
  "business.logoRemove": "Removed the logo",
  "trash.restore": "Put a deleted dish back",
  "trash.purge": "Removed a dish from the Trash for good",
  "customer.delete": "Erased a customer",
  "loyalty.adjust": "Adjusted a customer's points",
  "floor.table.delete": "Deleted a table",
};

export function describeAction(action: string): string {
  if (WORDS[action]) return WORDS[action];
  const t = action.replace(/[._]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The first few details of an event as "key: value" text, with no long values. */
export function detailText(detail: unknown, max = 160): string {
  if (!detail || typeof detail !== "object") return "";
  const parts = Object.entries(detail as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`);
  return parts.join(", ").slice(0, max);
}
