import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, fmtDate, niceName } from "../lib.js";
import { touchRecent } from "../recents.js";

function yearsList(years) {
  if (Array.isArray(years)) return years;
  if (typeof years === "string" && years.startsWith("[")) {
    try {
      const parsed = JSON.parse(years);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function upsertLocal(p) {
  const d = await api("/api/players", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: p.token,
      name: p.name || p.token,
      city: p.city || null,
      state: p.state || null,
    }),
  });
  return d.player;
}

function PlayerPicker({ label, value, onChange }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const years = value ? yearsList(value.years) : [];

  async function onSearch(e) {
    e.preventDefault();
    if (query.trim().length < 2 || searching) return;
    setSearching(true);
    setError(null);
    try {
      const d = await api("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: query.trim() }),
      });
      setHits(d.players || []);
    } catch (err) {
      setError(err.message);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="h2h-picker">
      <div className="h2h-picker-label">{label}</div>
      {value ? (
        <div className="h2h-selected">
          <div>
            <div className="result-name">{niceName(value.name)}</div>
            <div className="result-meta">
              {[value.city, value.state].filter(Boolean).join(", ")}
              {years.length ? ` · ranked ${years[0]}–${years[years.length - 1]}` : ""}
            </div>
          </div>
          <button type="button" className="btn small" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <form className="searchbox h2h-search" onSubmit={onSearch}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Last name, or “First Last” — e.g. Plutt"
            />
            <button disabled={searching}>{searching ? "…" : "Find"}</button>
          </form>
          {error && (
            <div className="error-box" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
          {hits.length > 0 && (
            <div className="h2h-hits">
              {hits.map((p) => (
                <button type="button" className="h2h-hit" key={p.token} onClick={() => onChange(p)}>
                  <span className="result-name">{niceName(p.name)}</span>
                  <span className="result-meta">
                    {[p.city, p.state].filter(Boolean).join(", ")}
                    {p.years?.length ? ` · ${p.years.join(", ")}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecordCard({ title, record, name1, name2 }) {
  if (!record || record.meetings === 0) {
    return (
      <div className="best-card h2h-record">
        <div className="age">{title}</div>
        <div className="rank" style={{ fontSize: 28 }}>
          —
        </div>
        <div className="when">No meetings</div>
      </div>
    );
  }
  const leader =
    record.player1Wins === record.player2Wins
      ? "Tied"
      : record.player1Wins > record.player2Wins
        ? `${name1} leads`
        : `${name2} leads`;
  return (
    <div className="best-card h2h-record">
      <div className="age">{title}</div>
      <div className="rank" style={{ fontSize: 36 }}>
        {record.player1Wins}–{record.player2Wins}
      </div>
      <div className="when">
        {leader} · {record.meetings} meeting{record.meetings === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function leadCopy(record, name1, name2) {
  if (!record || record.meetings === 0) return "No meetings on record";
  if (record.player1Wins === record.player2Wins) {
    return `Tied ${record.player1Wins}–${record.player2Wins} (${record.meetings} meetings)`;
  }
  if (record.player1Wins > record.player2Wins) {
    return `${name1} leads ${record.player1Wins}–${record.player2Wins}`;
  }
  return `${name2} leads ${record.player2Wins}–${record.player1Wins}`;
}

export default function H2H() {
  const { id1, id2 } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [player1, setPlayer1] = useState(null);
  const [player2, setPlayer2] = useState(null);
  const [discipline, setDiscipline] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Old /h2h?token1=&token2=&name1=... links: upsert lightweight rows, then replace with /h2h/:id1/:id2.
  useEffect(() => {
    if (id1 && id2) {
      if (params.get("token1") || params.get("token2")) {
        navigate(`/h2h/${id1}/${id2}`, { replace: true });
      }
      return;
    }
    const t1 = params.get("token1");
    const t2 = params.get("token2");
    if (!t1 && !t2) {
      if (location.state?.player1) setPlayer1(location.state.player1);
      if (location.state?.player2) setPlayer2(location.state.player2);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          t1
            ? upsertLocal({
                token: t1,
                name: params.get("name1"),
                city: params.get("city1"),
                state: params.get("state1"),
              })
            : null,
          t2
            ? upsertLocal({
                token: t2,
                name: params.get("name2"),
                city: params.get("city2"),
                state: params.get("state2"),
              })
            : null,
        ]);
        if (cancelled) return;
        if (a && b) {
          navigate(`/h2h/${a.id}/${b.id}`, { replace: true });
        } else {
          if (a) setPlayer1(a);
          if (b) setPlayer2(b);
          navigate("/h2h", { replace: true, state: { player1: a, player2: b } });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id1, id2]);

  const load = useCallback(async ({ force = false } = {}) => {
    const a = id1 || player1?.id;
    const b = id2 || player2?.id;
    if (!a || !b) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api(`/api/h2h/${a}/${b}${force ? "?force=1" : ""}`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id1, id2, player1?.id, player2?.id]);

  useEffect(() => {
    if (!id1 || !id2) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const [a, b] = await Promise.all([api(`/api/players/${id1}`), api(`/api/players/${id2}`)]);
        if (cancelled) return;
        setPlayer1(a.player);
        setPlayer2(b.player);
        touchRecent(a.player);
        touchRecent(b.player);
        const d = await api(`/api/h2h/${id1}/${id2}`);
        if (cancelled) return;
        setData(d);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id1, id2]);

  async function selectPlayer(which, picked) {
    if (!picked) {
      const keep1 = which === 1 ? null : player1;
      const keep2 = which === 2 ? null : player2;
      setPlayer1(keep1);
      setPlayer2(keep2);
      setData(null);
      setError(null);
      navigate("/h2h", { replace: true, state: { player1: keep1, player2: keep2 } });
      return;
    }
    setError(null);
    try {
      const player = await upsertLocal(picked);
      const next1 = which === 1 ? player : player1;
      const next2 = which === 2 ? player : player2;
      if (which === 1) setPlayer1(player);
      else setPlayer2(player);
      if (next1?.id && next2?.id) {
        if (next1.id === next2.id) {
          setError("Pick two different players");
          return;
        }
        navigate(`/h2h/${next1.id}/${next2.id}`);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredMatches = useMemo(() => {
    const list = data?.matches || [];
    if (discipline === "singles") return list.filter((m) => m.singles);
    if (discipline === "doubles") return list.filter((m) => !m.singles);
    return list;
  }, [data, discipline]);

  const name1 = niceName(data?.player1?.name || player1?.name || "Player 1");
  const name2 = niceName(data?.player2?.name || player2?.name || "Player 2");
  const activeRecord =
    discipline === "singles" ? data?.singlesRecord : discipline === "doubles" ? data?.doublesRecord : data?.record;

  return (
    <>
      <section className="hero" style={{ paddingBottom: 6 }}>
        <h1>
          Match <em>history.</em>
        </h1>
        <p className="lede">
          Head-to-head results from the USTA TennisLink player archive — every recorded meeting with score, round, and
          event. Ranking trajectory overlays stay on{" "}
          <Link to="/compare" style={{ color: "var(--ball)" }}>
            Compare
          </Link>
          .
        </p>
      </section>

      <section className="panel">
        <h2>Pick players</h2>
        <div className="h2h-pick-grid">
          <PlayerPicker label="Player 1" value={player1} onChange={(p) => selectPlayer(1, p)} />
          <div className="h2h-vs" aria-hidden>
            VS
          </div>
          <PlayerPicker label="Player 2" value={player2} onChange={(p) => selectPlayer(2, p)} />
        </div>
        {player1 && player2 && (
          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn solid" disabled={loading} onClick={() => load()}>
              {loading ? "Loading TennisLink records…" : "Refresh head to head"}
            </button>
            <button className="btn" disabled={loading} onClick={() => load({ force: true })}>
              Force re-fetch
            </button>
          </div>
        )}
        {loading && (
          <p className="search-hint" style={{ marginTop: 14 }}>
            <b>Pulling full match records from TennisLink…</b> first load can take up to a minute per player; later
            lookups are cached.
          </p>
        )}
      </section>

      {error && <div className="error-box">{error}</div>}

      {loading && !data && (
        <section className="panel">
          <div className="empty">
            <span className="spinner" /> Fetching archived player records…
          </div>
        </section>
      )}

      {data && (
        <>
          <section className="panel">
            <h2>
              {name1} <span style={{ color: "var(--chalk-dim)", fontWeight: 400 }}>vs</span> {name2}
            </h2>
            <p className="h2h-lead">{leadCopy(activeRecord, name1, name2)}</p>
            <div className="result-meta" style={{ marginBottom: 14 }}>
              {[data.player1?.overallRecord && `${name1} overall ${data.player1.overallRecord}`, data.player2?.overallRecord && `${name2} overall ${data.player2.overallRecord}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div className="chart-controls" style={{ marginBottom: 18 }}>
              {[
                ["all", "All"],
                ["singles", "Singles"],
                ["doubles", "Doubles"],
              ].map(([id, label]) => (
                <span
                  key={id}
                  className={`chip ${discipline === id ? "on" : ""}`}
                  style={discipline === id ? { background: "#d8e63a", borderColor: "#d8e63a" } : {}}
                  onClick={() => setDiscipline(id)}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="bests" style={{ marginTop: 8 }}>
              <RecordCard title="Overall" record={data.record} name1={name1} name2={name2} />
              <RecordCard title="Singles" record={data.singlesRecord} name1={name1} name2={name2} />
              <RecordCard title="Doubles" record={data.doublesRecord} name1={name1} name2={name2} />
            </div>
            <p className="chart-note">Match results via {data.source}{data.cached ? " (cached)" : ""}.</p>
          </section>

          <section className="panel">
            <h2>Meetings ({filteredMatches.length})</h2>
            {filteredMatches.length === 0 ? (
              <div className="empty">
                No recorded meetings between these two in the TennisLink archive
                {discipline !== "all" ? ` for ${discipline}` : ""}.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="snapshots">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Winner</th>
                      <th>Score</th>
                      <th>Round</th>
                      <th>Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatches.map((m, i) => (
                      <tr key={`${m.date}-${m.round}-${m.score}-${i}`}>
                        <td className="num">{fmtDate(m.date)}</td>
                        <td>
                          <span className={`tag ${m.player1Won ? "win" : "loss"}`}>{m.winnerName}</span>
                          <span className="result-meta" style={{ marginLeft: 8 }}>
                            {m.singles ? "Singles" : "Doubles"}
                            {m.partner ? ` · w/ ${m.partner}` : ""}
                          </span>
                        </td>
                        <td className="num">{m.score || "—"}</td>
                        <td>{m.round || "—"}</td>
                        <td>{m.eventName || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.rankingMeetings?.summary?.meetings > 0 && (
            <section className="panel">
              <h2>Same ranking lists ({data.rankingMeetings.summary.meetings})</h2>
              <p className="h2h-lead">
                On published USTA lists where both appear: {niceName(data.rankingMeetings.player1.name)} ranked ahead{" "}
                {data.rankingMeetings.summary.player1Ahead}× · {niceName(data.rankingMeetings.player2.name)} ahead{" "}
                {data.rankingMeetings.summary.player2Ahead}×
              </p>
              <div className="table-scroll">
                <table className="snapshots">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>{name1}</th>
                      <th>{name2}</th>
                      <th>List</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rankingMeetings.meetings.map((m) => (
                      <tr key={m.listId}>
                        <td className="num">{fmtDate(m.date)}</td>
                        <td className="num">#{m.player1Rank}</td>
                        <td className="num">#{m.player2Rank}</td>
                        <td>
                          {m.title}
                          <div className="result-meta">
                            {m.ageGroup} · {m.listType} · {m.variant}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
