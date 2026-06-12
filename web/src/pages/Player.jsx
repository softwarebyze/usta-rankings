import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ageColor, ageLabel, fmtDate, niceName } from "../lib.js";
import RankChart from "../RankChart.jsx";

const VARIANTS = ["Combined", "Sectional", "National", "Other"];

const TYPE_GROUPS = {
  "Tentative Ranking": "Ranking",
  "Final Ranking": "Ranking",
  "Standing List": "Standing",
  "Endorsement List": "Endorsement",
};
const typeGroup = (t) => TYPE_GROUPS[t] ?? "Other";

function ShareButton({ player }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [anchorLeft, setAnchorLeft] = useState(false);
  const ref = useRef(null);

  function toggle() {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAnchorLeft(rect.right < 400);
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const url = window.location.href;
  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  async function nativeShare() {
    try {
      await navigator.share({ title: `${niceName(player.name)} — USTA Junior Ranking History`, url });
    } catch {}
  }

  return (
    <div className="share-wrap" ref={ref}>
      <button className="btn" onClick={toggle}>
        Share ↗
      </button>
      {open && (
        <div className="share-pop" style={anchorLeft ? { left: 0, right: "auto" } : undefined}>
          <img src={`/api/players/${player.id}/og.png`} alt="Share card preview" loading="lazy" />
          <div className="share-actions">
            <button className="btn solid" onClick={copy}>
              {copied ? "Copied!" : "Copy link"}
            </button>
            {!!navigator.share && (
              <button className="btn" onClick={nativeShare}>
                Share…
              </button>
            )}
          </div>
          <div className="share-note">Links unfurl with this card on iMessage, X, Slack &amp; co.</div>
        </div>
      )}
    </div>
  );
}

export default function Player() {
  const { id } = useParams();
  const [player, setPlayer] = useState(null);
  const [job, setJob] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [agesOn, setAgesOn] = useState(null); // null = all
  const [variantsOn, setVariantsOn] = useState(new Set(VARIANTS));
  const [typesOn, setTypesOn] = useState(null); // null = auto (Ranking if available)

  const refresh = useCallback(async () => {
    const d = await api(`/api/players/${id}`);
    setPlayer(d.player);
    setJob(d.job);
    const r = await api(`/api/players/${id}/rankings`);
    setRankings(r.rankings);
    return d.job;
  }, [id]);

  useEffect(() => {
    let timer;
    let stopped = false;
    async function tick() {
      try {
        const j = await refresh();
        if (!stopped && (j?.status === "running" || j?.status === "pending")) {
          timer = setTimeout(tick, 3000);
        }
      } catch {
        if (!stopped) timer = setTimeout(tick, 5000);
      }
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  const ageGroups = useMemo(
    () => [...new Set(rankings.map((r) => r.age_group))].sort(),
    [rankings]
  );

  const bests = useMemo(() => {
    const best = new Map();
    for (const r of rankings) {
      const cur = best.get(r.age_group);
      if (!cur || r.rank < cur.rank) best.set(r.age_group, r);
    }
    return [...best.entries()].sort().map(([ag, r]) => ({ ag, ...r }));
  }, [rankings]);

  const typeGroupsPresent = useMemo(
    () => [...new Set(rankings.map((r) => typeGroup(r.list_type)))].sort(),
    [rankings]
  );
  const activeTypes = useMemo(() => {
    if (typesOn) return typesOn;
    return new Set(typeGroupsPresent.includes("Ranking") ? ["Ranking"] : typeGroupsPresent);
  }, [typesOn, typeGroupsPresent]);

  const series = useMemo(() => {
    const visibleAges = agesOn ?? new Set(ageGroups);
    const groups = new Map();
    for (const r of rankings) {
      if (!r.date || !visibleAges.has(r.age_group) || !variantsOn.has(r.variant)) continue;
      if (!activeTypes.has(typeGroup(r.list_type))) continue;
      const key = `${r.age_group} ${r.variant}`;
      if (!groups.has(key))
        groups.set(key, {
          key,
          label: `${ageLabel(r.age_group)} · ${r.variant}`,
          color: ageColor(r.age_group),
          dashed: r.variant !== "Combined",
          points: [],
        });
      groups.get(key).points.push({
        x: new Date(r.date).getTime(),
        rank: r.rank,
        date: r.date,
        title: r.title,
        points: r.points,
        list_type: r.list_type,
        variant: r.variant,
        seriesLabel: ageLabel(r.age_group),
      });
    }
    return [...groups.values()]
      .map((g) => ({ ...g, points: g.points.sort((a, b) => a.x - b.x) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [rankings, agesOn, variantsOn, ageGroups, activeTypes]);

  if (!player) return <div className="empty"><span className="spinner" /> Loading…</div>;

  const jobActive = job && (job.status === "running" || job.status === "pending");
  const progress = job?.lists_total ? Math.round((job.lists_checked / job.lists_total) * 100) : 0;

  function toggleAge(ag) {
    const cur = agesOn ?? new Set(ageGroups);
    const next = new Set(cur);
    next.has(ag) ? next.delete(ag) : next.add(ag);
    setAgesOn(next);
  }
  function toggleVariant(v) {
    const next = new Set(variantsOn);
    next.has(v) ? next.delete(v) : next.add(v);
    setVariantsOn(next);
  }

  return (
    <>
      <div className="player-head">
        <div>
          <h1>{niceName(player.name)}</h1>
          <div className="player-sub">
            {player.city}, {player.state}
            <span className="sep">|</span>
            {rankings.length} ranking snapshots
            {player.years && (
              <>
                <span className="sep">|</span>
                {JSON.parse(player.years).join(" · ")}
              </>
            )}
          </div>
        </div>
        <ShareButton player={player} />
      </div>

      {jobActive && (
        <div className="jobbar">
          <span className="pulse" />
          <span>
            {job.phase || "Queued"}
            {job.lists_total > 0 && ` — ${job.lists_checked}/${job.lists_total} lists, ${job.rankings_found} found`}
          </span>
          <div className="progress">
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {job?.status === "failed" && (
        <div className="jobbar failed">Scrape failed: {String(job.error).slice(0, 240)}</div>
      )}

      {bests.length > 0 && (
        <div className="bests">
          {bests.map((b) => (
            <div className="best-card" key={b.ag}>
              <div className="stripe" style={{ background: ageColor(b.ag) }} />
              <div className="age">{ageLabel(b.ag)} — best</div>
              <div className="rank">{b.rank}</div>
              <div className="when">
                {fmtDate(b.date)}
                <br />
                {b.title}
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="panel chart-panel">
        <h2>Ranking over time</h2>
        <div className="chart-controls">
          {ageGroups.map((ag) => {
            const on = (agesOn ?? new Set(ageGroups)).has(ag);
            return (
              <span
                key={ag}
                className={`chip ${on ? "on" : ""}`}
                style={on ? { background: ageColor(ag), borderColor: ageColor(ag) } : {}}
                onClick={() => toggleAge(ag)}
              >
                {ageLabel(ag)}
              </span>
            );
          })}
          <span style={{ width: 14 }} />
          {VARIANTS.filter((v) => rankings.some((r) => r.variant === v)).map((v) => {
            const on = variantsOn.has(v);
            return (
              <span
                key={v}
                className={`chip ${on ? "on" : ""}`}
                style={on ? { background: "#f4f1e8", borderColor: "#f4f1e8" } : {}}
                onClick={() => toggleVariant(v)}
              >
                {v}
              </span>
            );
          })}
          <span style={{ width: 14 }} />
          {typeGroupsPresent.map((t) => {
            const on = activeTypes.has(t);
            return (
              <span
                key={t}
                className={`chip ${on ? "on" : ""}`}
                style={on ? { background: "#e8b54a", borderColor: "#e8b54a" } : {}}
                onClick={() => {
                  const next = new Set(activeTypes);
                  next.has(t) ? next.delete(t) : next.add(t);
                  setTypesOn(next);
                }}
              >
                {t} lists
              </span>
            );
          })}
        </div>
        <RankChart series={series} />
        <div className="chart-note">
          Y-axis is inverted: #1 sits at the top, so a rising line means climbing the rankings. Each point is one
          published list (standing, tentative, endorsement or final).
        </div>
      </section>

      <section className="panel">
        <h2>All snapshots ({rankings.length})</h2>
        {rankings.length === 0 ? (
          <div className="empty">
            {jobActive ? "Snapshots will appear here as the scrape progresses…" : "No snapshots found."}
          </div>
        ) : (
          <table className="snapshots">
            <thead>
              <tr>
                <th>Published</th>
                <th>List</th>
                <th>Bracket</th>
                <th>Type</th>
                <th style={{ textAlign: "right" }}>Rank</th>
                <th style={{ textAlign: "right" }}>Points</th>
              </tr>
            </thead>
            <tbody>
              {[...rankings].reverse().map((r, i) => (
                <tr key={i}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.title}</td>
                  <td>
                    <span className="tag" style={{ color: ageColor(r.age_group) }}>
                      {ageLabel(r.age_group)}
                    </span>
                  </td>
                  <td>
                    {r.list_type} · {r.variant}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    #{r.rank}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {r.points?.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
