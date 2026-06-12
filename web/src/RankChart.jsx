import { useEffect, useState } from "react";
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
import { api, fmtDate, niceName } from "./lib.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ListContext({ listId, rank }) {
  const [ctx, setCtx] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!listId || !rank) return;
    let cancelled = false;
    setCtx(null);
    setErr(null);
    api(`/api/lists/${listId}/context?rank=${rank}`)
      .then((d) => !cancelled && setCtx(d))
      .catch((e) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [listId, rank]);

  if (err) return <div className="tt-context err">Could not load list context</div>;
  if (!ctx) return <div className="tt-context loading">Loading list…</div>;
  return (
    <div className="tt-context">
      <div className="tt-context-title">On this list</div>
      {ctx.rows.map((r) => (
        <div key={r.rank} className={`tt-row ${r.rank === rank ? "you" : ""}`}>
          <span className="tt-row-rank">#{r.rank}</span>
          <span className="tt-row-name">{niceName(r.name)}</span>
          <span className="tt-row-pts">{r.points?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const entries = payload
    .filter((p) => p.payload?.rank != null)
    .sort((a, b) => a.payload.rank - b.payload.rank);

  const primary = entries[0]?.payload;
  const listId = primary?.list_id;
  const rank = primary?.rank;

  return (
    <div className="rs-tooltip">
      {entries.length === 1 ? (
        <>
          <div className="tt-title">{primary.title}</div>
          <div className="tt-rank">#{primary.rank}</div>
          <div>
            {fmtDate(primary.date)} · {primary.points?.toLocaleString()} pts
          </div>
          <div style={{ opacity: 0.7 }}>
            {primary.seriesLabel} · {primary.list_type} ({primary.variant})
          </div>
        </>
      ) : (
        <>
          <div className="tt-title">{label != null ? (typeof label === "number" && label <= 12 ? MONTHS[Math.round(label)] : fmtDate(primary?.date)) : "Compare"}</div>
          <div className="tt-multi">
            {entries.map((p) => (
              <div key={p.dataKey} className="tt-multi-row" style={{ borderLeftColor: p.color }}>
                <span className="tt-multi-name">{p.name || p.payload.seriesLabel}</span>
                <span className="tt-multi-rank">#{p.payload.rank}</span>
                <span className="tt-multi-pts">{p.payload.points?.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
        </>
      )}
      {listId && rank && entries.length === 1 && <ListContext listId={listId} rank={rank} />}
    </div>
  );
}

/**
 * series: [{ key, label, color, dashed?, points: [{x, rank, date, title, points, list_type, variant, list_id}] }]
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
