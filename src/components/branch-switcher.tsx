"use client";

/** Picks the branch to work in; submits as soon as a branch is chosen. */
export function BranchSwitcher({
  action,
  branches,
  current,
}: {
  action: (formData: FormData) => void | Promise<void>;
  branches: { id: string; name: string }[];
  current: string;
}) {
  return (
    <form action={action}>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400">Branch</label>
      <select
        name="branch"
        defaultValue={current}
        aria-label="Branch"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="mt-1 w-full px-3 py-2 text-sm font-medium"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <noscript>
        <button className="mt-1 text-sm underline">Switch</button>
      </noscript>
    </form>
  );
}
