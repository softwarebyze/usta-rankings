import { useEffect, useMemo, useState } from "react";
import { api, ageLabel } from "../lib.js";
import RankChart from "../RankChart.jsx";

const PLAYER_COLORS = ["#d8e63a", "#e07a4f", "#9ad1ff", "#e8b54a", "#5fd0a5"];

export default function Compare() {
  const [players, setPlayers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [bracket, setBracket] = useState("18");
  const [data, setData] = useState({}); // playerId -> rankings

  useEffect(() => {
    api("/api/players").then((d) => {
      setPlayers(d.players);
      setSelected(d.players.slice(0, 2).map((p) => String(p.id)));
    });
  }, []);

  useEffect(() => {
    for (const id of selected) {
      if (id && !data[id]) {
        api(`/api/players/${id}/rankings`).then((d) =>
          setData((cur) => ({ ...cur, [id]: d.rankings }))
        );
      }
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const series = useMemo(() => {
    return selected
      .filter(Boolean)
      .map((id, i) => {
        const p = players.find((pl) => String(pl.id) === id);
        const rows = (data[id] ?? []).filter(
          (r) => r.date && String(r.age_group).slice(1) === bracket && r.variant === "Combined"
        );
        return {
          key: id,
          label: p ? p.name : id,
          color: PLAYER_COLORS[i % PLAYER_COLORS.length],
          points: rows
            .map((r) => ({
              x: new Date(r.date).getTime(),
              rank: r.rank,
              date: r.date,
              title: r.title,
              points: r.points,
              list_type: r.list_type,
              variant: r.variant,
              seriesLabel: p?.name ?? "",
            }))
            .sort((a, b) => a.x - b.x),
        };
      })
      .filter((s) => s.points.length > 0 || true);
  }, [selected, data, players, bracket]);

  const brackets = ["10", "12", "14", "16", "18"];

  function setSel(i, val) {
    const next = [...selected];
    next[i] = val;
    setSelected(next);
  }

  return (
    <>
      <section className="hero" style={{ paddingBottom: 6 }}>
        <h1>
          Head <em>to</em> head.
        </h1>
        <p className="lede">
          Overlay the ranking trajectories of any players on file (Combined lists). Build a player's history from
          the search page first, then compare here.
        </p>
      </section>

      <section className="panel">
        <h2>Pick players</h2>
        {players.length < 1 ? (
          <div className="empty">No players on file yet — search and build a history first.</div>
        ) : (
          <>
            <div className="compare-pickers">
              {[0, 1, 2].map((i) => (
                <select key={i} value={selected[i] ?? ""} onChange={(e) => setSel(i, e.target.value)}>
                  <option value="">— none —</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.snapshots})
                    </option>
                  ))}
                </select>
              ))}
            </div>
            <div className="chart-controls" style={{ marginTop: 14 }}>
              {brackets.map((b) => (
                <span
                  key={b}
                  className={`chip ${bracket === b ? "on" : ""}`}
                  style={bracket === b ? { background: "#d8e63a", borderColor: "#d8e63a" } : {}}
                  onClick={() => setBracket(b)}
                >
                  {b}s
                </span>
              ))}
            </div>
            <RankChart series={series} height={440} />
          </>
        )}
      </section>
    </>
  );
}
