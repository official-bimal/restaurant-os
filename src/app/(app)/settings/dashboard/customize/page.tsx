import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { getEditorState } from "@/features/dashboard/server/preferences";
import { TEMPLATE_INFO } from "@/features/dashboard/registry";
import type { Size } from "@/features/dashboard/layout";
import { saveLayoutAction } from "../actions";
import { LayoutEditor, type WidgetMeta } from "./layout-editor";

export const dynamic = "force-dynamic";

export default async function CustomizePage() {
  const ctx = await requireTenant();
  const st = await getEditorState(ctx);
  const widgets: WidgetMeta[] = st.widgets.map((w) => ({ id: w.id, title: w.title, description: w.description, group: w.group, sizes: [...w.sizes] }));
  const plain = (r: { visible: { id: string; size: Size }[]; hidden: { id: string; size: Size }[] }) => ({ visible: r.visible, hidden: r.hidden });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/settings/dashboard" className="text-sm text-stone-500 hover:underline">
          ← Dashboard settings
        </Link>
        <h1 className="text-2xl font-semibold">Customize dashboard</h1>
      </div>
      <p className="text-sm text-stone-600">
        Arrange the cards your dashboard shows. Drag a card by its handle, or press space on the handle and use the arrow keys. Desktop and phone have their own layouts. This layout is yours alone and follows you to every device you sign in on.
      </p>
      <LayoutEditor
        widgets={widgets}
        initial={{ desktop: plain(st.current.desktop), mobile: plain(st.current.mobile) }}
        defaults={{ desktop: plain(st.defaults.desktop), mobile: plain(st.defaults.mobile) }}
        template={st.template}
        templateName={TEMPLATE_INFO[st.template].name}
        save={saveLayoutAction}
      />
    </div>
  );
}
