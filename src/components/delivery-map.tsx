import { fitPoints, type Point } from "@/features/delivery/geo";

/**
 * A simple live map drawn right on the page: the branch, the delivery address and the rider, in true proportion
 * with north up and a scale bar. It uses no map tiles and no outside service, so nobody's phone or address is
 * sent anywhere to draw it. The page refreshes itself, which moves the rider's dot. Roads are not drawn.
 */
export function DeliveryMap({
  branch,
  destination,
  rider,
  riderAgeMinutes,
  branchLabel = "Restaurant",
}: {
  branch: Point | null;
  destination: Point | null;
  rider: Point | null;
  riderAgeMinutes?: number | null;
  branchLabel?: string;
}) {
  const items: { key: "branch" | "dest" | "rider"; p: Point }[] = [];
  if (branch) items.push({ key: "branch", p: branch });
  if (destination) items.push({ key: "dest", p: destination });
  if (rider) items.push({ key: "rider", p: rider });
  if (items.length < 2) return null;

  const W = 420;
  const H = 260;
  const { xy, metersPerPixel } = fitPoints(items.map((i) => i.p), W, H, 44);
  const at = (key: string) => xy[items.findIndex((i) => i.key === key)];
  const b = at("branch");
  const d = at("dest");
  const r = at("rider");

  // A scale bar of a round length that is roughly a quarter of the width.
  const target = (W / 4) * metersPerPixel;
  const nice = [100, 200, 500, 1000, 2000, 5000, 10000].reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best), 100);
  const barPx = nice / metersPerPixel;
  const stale = typeof riderAgeMinutes === "number" && riderAgeMinutes >= 5;

  return (
    <figure className="overflow-hidden rounded-2xl border border-stone-200 bg-emerald-50/50">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map showing the restaurant, the delivery address and the rider" className="block w-full">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#d6d3d1" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />

        {b && d && <line x1={b.x} y1={b.y} x2={d.x} y2={d.y} stroke="#a8a29e" strokeWidth="2" strokeDasharray="6 6" />}
        {r && d && <line x1={r.x} y1={r.y} x2={d.x} y2={d.y} stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />}

        {b && (
          <g>
            <rect x={b.x - 8} y={b.y - 8} width="16" height="16" rx="4" fill="#4f46e5" stroke="#fff" strokeWidth="2" />
            <text x={b.x} y={b.y - 14} textAnchor="middle" fontSize="11" fontWeight="600" fill="#0e6a63">
              {branchLabel}
            </text>
          </g>
        )}
        {d && (
          <g>
            <path d={`M ${d.x} ${d.y + 2} l -9 -18 a 9.5 9.5 0 1 1 18 0 z`} fill="#e11d48" stroke="#fff" strokeWidth="2" />
            <circle cx={d.x} cy={d.y - 16} r="3.2" fill="#fff" />
            <text x={d.x} y={d.y + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill="#9f1239">
              Delivery address
            </text>
          </g>
        )}
        {r && (
          <g opacity={stale ? 0.55 : 1}>
            <circle cx={r.x} cy={r.y} r="13" fill="#f97316" opacity="0.25" />
            <circle cx={r.x} cy={r.y} r="7" fill="#f97316" stroke="#fff" strokeWidth="2.5" />
            <text x={r.x} y={r.y - 16} textAnchor="middle" fontSize="11" fontWeight="600" fill="#c2410c">
              Rider
            </text>
          </g>
        )}

        <g transform={`translate(16 ${H - 18})`}>
          <line x1="0" y1="0" x2={barPx} y2="0" stroke="#44403c" strokeWidth="2" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke="#44403c" strokeWidth="2" />
          <line x1={barPx} y1="-4" x2={barPx} y2="4" stroke="#44403c" strokeWidth="2" />
          <text x={barPx + 6} y="4" fontSize="11" fill="#44403c">
            {nice >= 1000 ? `${nice / 1000} km` : `${nice} m`}
          </text>
        </g>
        <g transform={`translate(${W - 22} 24)`} fontSize="11" fill="#44403c" textAnchor="middle">
          <path d="M 0 -12 l 6 14 l -6 -4 l -6 4 z" fill="#44403c" />
          <text y="16">N</text>
        </g>
      </svg>
      {r && (
        <figcaption className="px-3 py-2 text-xs text-stone-600">
          Rider seen {riderAgeMinutes == null || riderAgeMinutes < 1 ? "just now" : `${riderAgeMinutes} min ago`}
          {stale ? " (position may be out of date)" : ""}. Updates by itself.
        </figcaption>
      )}
    </figure>
  );
}
