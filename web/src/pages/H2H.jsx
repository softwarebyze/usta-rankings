import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, fmtDate, h2hSlug, niceName, titleFromH2hSlug } from "../lib.js";

function PlayerPicker({ label, value, onChange, prefetchStatus }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

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
              {value.years?.length ? ` · ranked ${value.years[0]}–${value.years[value.years.length - 1]}` : ""}
            </div>
            {prefetchStatus === "loading" && (
              <div className="result-years">Warming TennisLink record…</div>
            )}
            {prefetchStatus === "ready" && <div className="result-years">Record ready</div>}
            {prefetchStatus === "error" && (
              <div className="result-years" style={{ color: "var(--clay)" }}>
                Prefetch failed — will retry on compare
              </div>
            )}
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

function playerFromParams(params, side) {
  const token = params.get(`t${side}`) || params.get(`token${side}`);
  if (!token) return null;
  return {
    token,
    name: params.get(`name${side}`) || params.get(`n${side}`) || token,
    city: params.get(`city${side}`) || null,
    state: params.get(`state${side}`) || null,
  };
}

export default function H2H() {
  const { slug: routeSlug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [player1, setPlayer1] = useState(null);
  const [player2, setPlayer2] = useState(null);
  const [prefetch, setPrefetch] = useState({}); // token -> loading|ready|error
  const [discipline, setDiscipline] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const a = playerFromParams(params, 1);
    const b = playerFromParams(params, 2);
    if (a && !player1) setPlayer1(a);
    if (b && !player2) setPlayer2(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prefetchRecord = useCallback((player) => {
    if (!player?.token) return;
    const token = player.token;
    setPrefetch((cur) => (cur[token] === "ready" || cur[token] === "loading" ? cur : { ...cur, [token]: "loading" }));
    api(`/api/records?token=${encodeURIComponent(token)}`)
      .then(() => setPrefetch((cur) => ({ ...cur, [token]: "ready" })))
      .catch(() => setPrefetch((cur) => ({ ...cur, [token]: "error" })));
  }, []);

  function selectPlayer(side, player) {
    if (side === 1) setPlayer1(player);
    else setPlayer2(player);
    if (player) prefetchRecord(player);
  }

  const syncUrl = useCallback(
    (a, b) => {
      if (!a?.token || !b?.token) return;
      const slug = h2hSlug(a.name, b.name) || "matchup";
      const qs = new URLSearchParams({
        t1: a.token,
        t2: b.token,
        n1: niceName(a.name),
        n2: niceName(b.name),
      });
      if (a.city) qs.set("city1", a.city);
      if (b.city) qs.set("city2", b.city);
      if (a.state) qs.set("state1", a.state);
      if (b.state) qs.set("state2", b.state);
      navigate(`/h2h/${slug}?${qs}`, { replace: true });
      document.title = `${niceName(a.name)} vs ${niceName(b.name)} — Match History | Baseline`;
    },
    [navigate]
  );

  const load = useCallback(
    async (a, b, { force = false } = {}) => {
      if (!a?.token || !b?.token) return;
      setLoading(true);
      setError(null);
      setData(null);
      const qs = new URLSearchParams({
        t1: a.token,
        t2: b.token,
        name1: a.name || "",
        name2: b.name || "",
      });
      if (a.city) qs.set("city1", a.city);
      if (b.city) qs.set("city2", b.city);
      if (a.state) qs.set("state1", a.state);
      if (b.state) qs.set("state2", b.state);
      if (force) qs.set("force", "1");
      try {
        const d = await api(`/api/h2h?${qs}`);
        setData(d);
        syncUrl(a, b);
        setPrefetch((cur) => ({
          ...cur,
          [a.token]: "ready",
          [b.token]: "ready",
        }));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [syncUrl]
  );

  useEffect(() => {
    if (player1?.token && player2?.token) load(player1, player2);
  }, [player1?.token, player2?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a readable title even before both players are chosen
  useEffect(() => {
    if (player1 && player2) return;
    const fromSlug = titleFromH2hSlug(routeSlug);
    document.title = fromSlug
      ? `${fromSlug} — Match History | Baseline`
      : "Head to Head — Match History | Baseline";
  }, [routeSlug, player1, player2]);

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

  const warmHint =
    (player1 && prefetch[player1.token] === "loading") || (player2 && prefetch[player2.token] === "loading");

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
          <PlayerPicker
            label="Player 1"
            value={player1}
            onChange={(p) => selectPlayer(1, p)}
            prefetchStatus={player1 ? prefetch[player1.token] : null}
          />
          <div className="h2h-vs" aria-hidden>
            VS
          </div>
          <PlayerPicker
            label="Player 2"
            value={player2}
            onChange={(p) => selectPlayer(2, p)}
            prefetchStatus={player2 ? prefetch[player2.token] : null}
          />
        </div>
        {player1 && player2 && (
          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn solid" disabled={loading} onClick={() => load(player1, player2)}>
              {loading ? "Loading TennisLink records…" : "Refresh head to head"}
            </button>
            <button className="btn" disabled={loading} onClick={() => load(player1, player2, { force: true })}>
              Force re-fetch
            </button>
          </div>
        )}
        {(loading || warmHint) && (
          <p className="search-hint" style={{ marginTop: 14 }}>
            <b>{loading ? "Pulling full match records from TennisLink…" : "Prefetching records in the background…"}</b>{" "}
            first load can take up to a minute per player; later lookups are cached.
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
              {[
                data.player1?.overallRecord && `${name1} overall ${data.player1.overallRecord}`,
                data.player2?.overallRecord && `${name2} overall ${data.player2.overallRecord}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div className="chart-controls" style={{ marginBottom: 18 }}>
              {[
                ["all", "All"],
                ["singles", "Singles"],
                ["doubles", "Doubles"],
              ].map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  className={`chip ${discipline === id ? "on" : ""}`}
                  aria-pressed={discipline === id}
                  style={discipline === id ? { background: "#d8e63a", borderColor: "#d8e63a" } : {}}
                  onClick={() => setDiscipline(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="bests" style={{ marginTop: 8 }}>
              <RecordCard title="Overall" record={data.record} name1={name1} name2={name2} />
              <RecordCard title="Singles" record={data.singlesRecord} name1={name1} name2={name2} />
              <RecordCard title="Doubles" record={data.doublesRecord} name1={name1} name2={name2} />
            </div>
            <p className="chart-note">
              Match results via {data.source}
              {data.cached ? " (cached)" : ""}.
            </p>
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
                {data.rankingMeetings.summary.ties
                  ? ` · tied ${data.rankingMeetings.summary.ties}×`
                  : ""}
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
