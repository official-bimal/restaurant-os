import { niceMax, shortMoney, type Slice } from "@/features/reports/charts";

/**
 * Small charts drawn as SVG on the server: no chart library, nothing to download, and they scale to any width. Money values are paisa.
 * Each mark has a <title>, so hovering (or a screen reader) tells the exact figure.
 */

const W = 640;
const H = 220;
const PAD = { l: 52, r: 12, t: 12, b: 28 };
const BRAND = "#0f857a";
const GRID = "#e7e5e4";

function Axes({ max, ticks = 4 }: { max: number; ticks?: number }) {
  return (
    <g fontSize={11} fill="#78716c">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i;
        const y = PAD.t + (H - PAD.t - PAD.b) * (1 - i / ticks);
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke={GRID} />
            <text x={PAD.l - 8} y={y + 4} textAnchor="end">
              {shortMoney(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Bars, one per label (for example the 24 hours of a day). `labelEvery` thins the labels under the bars. */
export function BarChart({ values, labels, labelEvery = 1, ariaLabel }: { values: number[]; labels: string[]; labelEvery?: number; ariaLabel: string }) {
  const max = niceMax(Math.max(...values, 0));
  const inner = W - PAD.l - PAD.r;
  const step = inner / values.length;
  const bar = step * 0.64;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="h-auto w-full">
      <Axes max={max} />
      {values.map((v, i) => {
        const h = ((H - PAD.t - PAD.b) * Math.max(0, v)) / max;
        const x = PAD.l + step * i + (step - bar) / 2;
        return (
          <g key={i}>
            <rect x={x} y={H - PAD.b - h} width={bar} height={Math.max(h, v > 0 ? 2 : 0)} rx={3} fill={BRAND} opacity={0.9}>
              <title>{`${labels[i]}: ${shortMoney(v)}`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x + bar / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#78716c">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export interface LineSeries {
  name: string;
  values: number[];
  color: string;
  dashed?: boolean;
}

/** One or more lines over the same labels. */
export function LineChart({ series, labels, ariaLabel }: { series: LineSeries[]; labels: string[]; ariaLabel: string }) {
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 0));
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / n;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - Math.max(0, v) / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="h-auto w-full">
      <Axes max={max} />
      {labels.map((l, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#78716c">
          {l}
        </text>
      ))}
      {series.map((s) => (
        <g key={s.name}>
          <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "6 5" : undefined} />
          {s.values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="#fff" stroke={s.color} strokeWidth={2}>
              <title>{`${s.name}, ${labels[i]}: ${shortMoney(v)}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}

const SLICE_COLORS = ["#0f857a", "#f59e0b", "#6366f1", "#ef4444", "#a8a29e"];

/** A ring split by share, with the biggest share first and a legend beside it. */
export function Donut({ slices, centre, ariaLabel, format }: { slices: Slice[]; centre: string; ariaLabel: string; format: (paisa: number) => string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  // Where each slice starts along the ring: the length of all the slices before it.
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((n, x) => n + (x.percent / 100) * C, 0));
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg viewBox="0 0 140 140" role="img" aria-label={ariaLabel} className="size-36 shrink-0">
        <circle cx={70} cy={70} r={R} fill="none" stroke={GRID} strokeWidth={18} />
        {slices.map((s, i) => {
          const len = (s.percent / 100) * C;
          return (
            <circle key={s.label} cx={70} cy={70} r={R} fill="none" stroke={SLICE_COLORS[i % SLICE_COLORS.length]} strokeWidth={18} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-starts[i]!} transform="rotate(-90 70 70)">
              <title>{`${s.label}: ${format(s.amount)} (${s.percent}%)`}</title>
            </circle>
          );
        })}
        <text x={70} y={66} textAnchor="middle" fontSize={11} fill="#78716c">
          Total
        </text>
        <text x={70} y={84} textAnchor="middle" fontSize={15} fontWeight={700} fill="#1c1917">
          {centre}
        </text>
      </svg>
      <ul className="w-full min-w-0 space-y-1.5 text-sm">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} aria-hidden="true" />
            <span className="flex-1">{s.label}</span>
            <span className="tabular-nums text-stone-500">{s.percent}%</span>
            <span className="w-24 text-right font-medium tabular-nums">{format(s.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
