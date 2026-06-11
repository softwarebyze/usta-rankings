import { useEffect, useMemo, useState } from "react";
import { api, niceName } from "../lib.js";
import RankChart from "../RankChart.jsx";

const PLAYER_COLORS = ["#d8e63a", "#e07a4f", "#9ad1ff", "#e8b54a", "#5fd0a5", "#c9c4b4", "#b48ee0", "#7ee0d2"];

// month-of-year fraction (0–12) for the season overlay axis
function seasonX(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return m - 1 + (d - 1) / 31;
}

export default function Compare() {
  const [players, setPlayers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [bracket, setBracket] = useState("18");
  const [mode, setMode] = useState("time"); // "time" | "season"
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

  // available brackets across the selected players
  const brackets = useMemo(() => {
    const found = new Set();
    for (const id of selected) for (const r of data[id] ?? []) found.add(String(r.age_group).slice(1));
    const all = ["10", "12", "14", "16", "18"];
    return all.filter((b) => found.size === 0 || found.has(b));
  }, [selected, data]);

  const series = useMemo(() => {
    const out = [];
    let colorIdx = 0;
    for (const id of selected.filter(Boolean)) {
      const p = players.find((pl) => String(pl.id) === id);
      const rows = (data[id] ?? []).filter(
        (r) =>
          r.date &&
          String(r.age_group).slice(1) === bracket &&
          (r.discipline || "Singles") !== "Doubles" &&
          /Ranking/.test(r.list_type)
      );
      // prefer one rank per date: best (lowest) across variants
      const byDate = new Map();
      for (const r of rows) {
        const cur = byDate.get(r.date);
        if (!cur || r.rank < cur.rank) byDate.set(r.date, r);
      }
      const deduped = [...byDate.values()];

      const mkPoint = (r, label) => ({
        x: mode === "season" ? seasonX(r.date) : new Date(r.date).getTime(),
        rank: r.rank,
        date: r.date,
        title: r.title,
        points: r.points,
        list_type: r.list_type,
        variant: r.variant,
        seriesLabel: label,
      });

      if (mode === "season") {
        // one line per (player, calendar year) so different years overlap
        const byYear = new Map();
        for (const r of deduped) {
          const y = r.date.slice(0, 4);
          if (!byYear.has(y)) byYear.set(y, []);
          byYear.get(y).push(r);
        }
        for (const [year, list] of [...byYear.entries()].sort()) {
          const label = `${niceName(p?.name ?? id)} ’${year.slice(2)}`;
          out.push({
            key: `${id}:${year}`,
            label,
            color: PLAYER_COLORS[colorIdx++ % PLAYER_COLORS.length],
            points: list.map((r) => mkPoint(r, label)).sort((a, b) => a.x - b.x),
          });
        }
      } else {
        const label = niceName(p?.name ?? id);
        out.push({
          key: id,
          label,
          color: PLAYER_COLORS[colorIdx++ % PLAYER_COLORS.length],
          points: deduped.map((r) => mkPoint(r, label)).sort((a, b) => a.x - b.x),
        });
      }
    }
    return out;
  }, [selected, data, players, bracket, mode]);

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
          Overlay ranking trajectories in any age bracket. <b>Season overlay</b> lines up different calendar years on
          one Jan–Dec axis — so a 2007 season and a 2016 season (or your own 12s years) can be compared directly.
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
                      {niceName(p.name)} ({p.snapshots})
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
              <span style={{ width: 14 }} />
              {[
                ["time", "Timeline"],
                ["season", "Season overlay"],
              ].map(([m, label]) => (
                <span
                  key={m}
                  className={`chip ${mode === m ? "on" : ""}`}
                  style={mode === m ? { background: "#e8b54a", borderColor: "#e8b54a" } : {}}
                  onClick={() => setMode(m)}
                >
                  {label}
                </span>
              ))}
            </div>
            <RankChart series={series} height={440} mode={mode} />
            <div className="chart-note">
              {mode === "season"
                ? "Each line is one player-season (ranking lists only, best rank per date). The x-axis is the month of the year, so seasons from different calendar years overlap."
                : "Ranking lists only, best rank per date across variants. Switch to Season overlay to line up different calendar years."}
            </div>
          </>
        )}
      </section>
    </>
  );
}
