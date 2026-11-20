import type { CSSProperties } from "react";
import { COLUMNS, SPAN, type Placed, type ResolvedLayout, type Template } from "./layout";
import { RENDERERS } from "./widgets";
import type { PermissionSubject } from "@/server/permissions";
import type { DashboardData } from "./server/data";

/**
 * The dashboard as people see it: ONE set of widgets in the page, placed for the phone and for the desktop by CSS variables (order, width,
 * hidden on one device), so the two layouts never render anything twice. There is nothing draggable here; arranging happens only in
 * Settings, Dashboard Settings, Customize.
 */

export function placementStyle(id: string, desktop: Placed[], mobile: Placed[]): { style: CSSProperties; hm: boolean; hd: boolean } {
  const di = desktop.findIndex((p) => p.id === id);
  const mi = mobile.findIndex((p) => p.id === id);
  const d = desktop[di];
  const m = mobile[mi];
  const style = {
    "--od": di < 0 ? 999 : di,
    "--om": mi < 0 ? 999 : mi,
    "--sd": SPAN.desktop[d?.size ?? "S"],
    "--sm": SPAN.mobile[m?.size ?? "S"],
  } as CSSProperties;
  return { style, hm: !m, hd: !d };
}

export function DashboardGrid({ d, who, t, desktop, mobile }: { d: DashboardData; who: PermissionSubject; t: Template; desktop: ResolvedLayout; mobile: ResolvedLayout }) {
  const ids = [...new Set([...desktop.visible, ...mobile.visible].map((p) => p.id))];
  void COLUMNS;
  const nodes = ids.flatMap((id) => {
    const size = (desktop.visible.find((p) => p.id === id) ?? mobile.visible.find((p) => p.id === id))!.size;
    const render = RENDERERS[id];
    const node = render?.({ d, size, t, who });
    if (!node) return [];
    const { style, hm, hd } = placementStyle(id, desktop.visible, mobile.visible);
    return [
      <div key={id} className="dash-item" style={style} data-hm={hm ? "1" : undefined} data-hd={hd ? "1" : undefined} data-widget={id}>
        {node}
      </div>,
    ];
  });
  return (
    <div className={`dash-grid dash-t-${t.toLowerCase()}`} data-template={t}>
      {nodes}
    </div>
  );
}
