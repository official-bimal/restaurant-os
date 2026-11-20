import { requireTenant } from "@/server/auth";
import { charsPerLine } from "@/lib/pdf";
import { getPrintConfig, paperFor } from "@/features/printing/server/settings";
import { cleanFields } from "@/features/printing/slip-fields";
import { PrintingTabs } from "../printing-tabs";
import { saveFieldsAction } from "../printer-actions";
import { FieldsForm } from "./fields-form";

export const dynamic = "force-dynamic";

export default async function FieldsPage({ searchParams }: PageProps<"/printing/fields">) {
  const ctx = await requireTenant("print.manage");
  const q = await searchParams;
  const cfg = await getPrintConfig(ctx.businessId);
  const cols = charsPerLine(paperFor(cfg));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Printing</h1>
        <p className="text-sm text-stone-500">Choose what appears on a kitchen slip and on a bill.</p>
      </div>
      <PrintingTabs current="/printing/fields" />
      {typeof q.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {q.error}
        </p>
      )}
      {typeof q.note === "string" && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {q.note}
        </p>
      )}
      <FieldsForm initial={cleanFields(cfg.fields)} layout={cfg} cols={cols} save={saveFieldsAction} />
    </div>
  );
}
