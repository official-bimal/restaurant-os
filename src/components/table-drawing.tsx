import { tableShape } from "@/lib/table-shape";

/** One table drawn with its chairs, from above. Round for small parties, long for big ones. Free tables are grey; busy ones are teal. */
export function TableDrawing({ capacity, busy, label, className = "mx-auto h-24 w-full" }: { capacity: number; busy: boolean; label: string; className?: string }) {
  const shape = tableShape(capacity);
  const body = busy ? "#0f857a" : "#e7e5e4";
  const chair = busy ? "#6cc4ba" : "#d0cdca";
  return (
    <svg viewBox={`0 0 ${shape.width} ${shape.height}`} className={className} aria-hidden="true">
      {shape.seats.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={4} fill={chair} transform={`rotate(${s.rotate} ${s.x + s.w / 2} ${s.y + s.h / 2})`} />
      ))}
      {shape.body.kind === "circle" ? (
        <circle cx={shape.body.cx} cy={shape.body.cy} r={shape.body.r} fill={body} />
      ) : (
        <rect x={shape.body.x} y={shape.body.y} width={shape.body.w} height={shape.body.h} rx={10} fill={body} />
      )}
      <text
        x={shape.body.kind === "circle" ? shape.body.cx : shape.body.x + shape.body.w / 2}
        y={shape.body.kind === "circle" ? shape.body.cy : shape.body.y + shape.body.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={label.length > 3 ? 14 : 18}
        fontWeight={700}
        fill={busy ? "#ffffff" : "#44403c"}
      >
        {label}
      </text>
    </svg>
  );
}
