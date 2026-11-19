/** Pure: what the Trash keeps and for how long. */

export const TRASH_DAYS = 30;

export function trashCutoff(now: Date): Date {
  return new Date(now.getTime() - TRASH_DAYS * 86_400_000);
}

export interface DishSnapshot {
  id: string;
  categoryId: string;
  stationId: string | null;
  name: string;
  nameNe: string | null;
  price: number;
  prepMinutes: number;
  available: boolean;
  recipe: { stockItemId: string; quantity: number }[];
}
