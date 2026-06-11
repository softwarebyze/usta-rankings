import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { fmtDate } from "./lib.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rs-tooltip">
      <div className="tt-title">{p.title}</div>
      <div className="tt-rank">#{p.rank}</div>
      <div>
        {fmtDate(p.date)} · {p.points?.toLocaleString()} pts
      </div>
      <div style={{ opacity: 0.7 }}>
        {p.seriesLabel} · {p.list_type} ({p.variant})
      </div>
    </div>
  );
}

/**
 * series: [{ key, label, color, dashed?, points: [{x, rank, date, title, points, list_type, variant}] }]
 * mode: "time" (x = epoch ms) or "season" (x = month-of-year fraction, 0–12)
 */
export default function RankChart({ series, height = 420, mode = "time" }) {
  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  if (allX.length === 0) return <div className="empty">No snapshots match the current filters.</div>;

  const xProps =
    mode === "season"
      ? {
          type: "number",
          domain: [0, 12],
          ticks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          tickFormatter: (t) => MONTHS[Math.round(t)] ?? "",
        }
      : {
          type: "number",
          scale: "time",
          domain: ["dataMin", "dataMax"],
          tickFormatter: (t) => new Date(t).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart margin={{ top: 12, right: 24, bottom: 6, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="2 6" />
        <XAxis
          dataKey="x"
          {...xProps}
          stroke="#c9c4b4"
          tick={{ fontSize: 12, fontFamily: "Archivo Narrow" }}
          tickMargin={8}
        />
        <YAxis
          reversed
          dataKey="rank"
          domain={[1, "auto"]}
          allowDecimals={false}
          stroke="#c9c4b4"
          tick={{ fontSize: 12, fontFamily: "Archivo Narrow" }}
          tickFormatter={(v) => `#${v}`}
          width={56}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontFamily: "Archivo Narrow", fontSize: 13, paddingTop: 10 }}
          iconType="plainline"
        />
        {series.map((s) => (
          <Line
            key={s.key}
            data={s.points}
            dataKey="rank"
            name={s.label}
            stroke={s.color}
            strokeWidth={2.5}
            strokeDasharray={s.dashed ? "7 5" : undefined}
            dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
