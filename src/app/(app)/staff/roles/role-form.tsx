"use client";

import { useState } from "react";

interface Group {
  title: string;
  items: { key: string; label: string }[];
}

const DOT: Record<string, string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  stone: "bg-stone-500",
};

export function RoleDot({ color }: { color: string }) {
  return <span className={`inline-block size-3 rounded-full ${DOT[color] ?? DOT.stone}`} />;
}

/** One role: name, colour, the built-in role it is based on, and the ticked permissions. Choosing a base fills in its usual ticks. */
export function RoleForm({
  action,
  groups,
  colors,
  bases,
  matrix,
  initial,
  submitLabel,
}: {
  action: (fd: FormData) => void | Promise<void>;
  groups: Group[];
  colors: string[];
  bases: { value: string; label: string }[];
  matrix: Record<string, string[]>;
  initial: { name: string; color: string; baseRole: string; permissions: string[] };
  submitLabel: string;
}) {
  const [base, setBase] = useState(initial.baseRole);
  const [ticked, setTicked] = useState<Set<string>>(new Set(initial.permissions));
  const toggle = (k: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Name
          <input name="name" required minLength={2} maxLength={30} defaultValue={initial.name} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base" placeholder="Shift lead" />
        </label>
        <label className="text-sm">
          Colour
          <select name="color" defaultValue={initial.color} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base">
            {colors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Works like a
          <select
            name="baseRole"
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              setTicked(new Set(matrix[e.target.value] ?? []));
            }}
            className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
          >
            {bases.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-stone-500">&ldquo;Works like a&rdquo; decides which screens the person gets (kitchen screen, rider page, accountant view) and fills in the usual ticks. Change the ticks below to fit.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g.title} className="rounded-lg border border-stone-200 p-3">
            <legend className="px-1 text-sm font-semibold">{g.title}</legend>
            {g.items.map((i) => (
              <label key={i.key} className="flex items-start gap-2 py-1 text-sm">
                <input type="checkbox" name="perm" value={i.key} checked={ticked.has(i.key)} onChange={() => toggle(i.key)} className="mt-1" />
                {i.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <button className="min-h-11 rounded-lg bg-brand-600 px-6 font-medium text-white">{submitLabel}</button>
    </form>
  );
}
