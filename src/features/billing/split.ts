/**
 * Even split of a bill between N people. Pure, no I/O. Amounts are integer paisa.
 *
 * Whole rupees are used when the total is a whole number of rupees (the bill is usually
 * rounded to the rupee), so nobody is asked for odd paisa. Any remainder goes one unit at a
 * time to the first people, so the parts always add up to the total exactly.
 */
export function splitEvenly(total: number, people: number): number[] {
  if (!Number.isInteger(total) || total < 0) throw new RangeError("total must be a non-negative integer");
  if (!Number.isInteger(people) || people < 1 || people > 50) throw new RangeError("people must be between 1 and 50");
  const unit = total % 100 === 0 ? 100 : 1;
  const units = total / unit;
  const base = Math.floor(units / people);
  const extra = units - base * people;
  return Array.from({ length: people }, (_, i) => (base + (i < extra ? 1 : 0)) * unit);
}
