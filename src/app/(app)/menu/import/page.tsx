import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { MenuImport } from "./menu-import";

export const dynamic = "force-dynamic";

export default async function MenuImportPage() {
  await requireTenant("menu.manage");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/menu" className="text-sm text-stone-500 hover:underline">
          ← Menu
        </Link>
        <h1 className="text-2xl font-semibold">Menu spreadsheet</h1>
      </div>
      <section className="card space-y-2 p-5 text-sm text-stone-600">
        <p>
          <a href="/menu/export" className="font-medium text-brand-700 underline">
            Download the menu as a CSV
          </a>
          , open it in Excel or Google Sheets, change prices or add rows, save it as CSV and choose it below. You see what would change before anything is saved.
        </p>
        <p>
          Columns: <strong>Category, Name, Nepali name, Price, Station, Prep minutes, Available</strong>. Only Name and Price are required; the rest can be left empty: a new dish then goes to &ldquo;Menu&rdquo; with 15 minutes prep and available, and an existing dish
          keeps whatever it has. A dish is matched by name, so changing a price updates the dish and does not make a copy. New categories and stations are created. A dish left out of the file is left as it is: nothing is
          ever deleted by an upload.
        </p>
      </section>
      <MenuImport />
    </div>
  );
}
