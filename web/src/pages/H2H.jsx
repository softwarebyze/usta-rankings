import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, fmtDate, niceName } from "../lib.js";

function PlayerPicker({ label, value, onChange }) {
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
      const d = await api(`/api/utr/search?q=${encodeURIComponent(query.trim())}`);
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
            <div className="result-name">{value.name}</div>
            <div className="result-meta">
              {[value.location, value.singlesUtr ? `UTR ${value.singlesUtr}` : null].filter(Boolean).join(" · ")}
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
              placeholder="First Last — e.g. Michael Plutt"
            />
            <button disabled={searching}>{searching ? "…" : "Find"}</button>
          </form>
          {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
          {hits.length > 0 && (
            <div className="h2h-hits">
              {hits.map((p) => (
                <button type="button" className="h2h-hit" key={p.id} onClick={() => onChange(p)}>
                  <span className="result-name">{p.name}</span>
                  <span className="result-meta">
                    {[p.location, p.singlesUtr ? `UTR ${p.singlesUtr}` : null].filter(Boolean).join(" · ")}
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
  const [params, setParams] = useSearchParams();
  const [player1, setPlayer1] = useState(null);
  const [player2, setPlayer2] = useState(null);
  const [discipline, setDiscipline] = useState("all"); // all | singles | doubles
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Hydrate from URL once
  useEffect(() => {
    const p1 = params.get("player1");
    const p2 = params.get("player2");
    if (p1 && !player1) {
      setPlayer1({
        id: p1,
        name: params.get("name1") || `Player ${p1}`,
        location: params.get("location1") || null,
        city: params.get("city1") || null,
        state: params.get("state1") || null,
        singlesUtr: params.get("utr1") || null,
      });
    }
    if (p2 && !player2) {
      setPlayer2({
        id: p2,
        name: params.get("name2") || `Player ${p2}`,
        location: params.get("location2") || null,
        city: params.get("city2") || null,
        state: params.get("state2") || null,
        singlesUtr: params.get("utr2") || null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (a, b) => {
    if (!a?.id || !b?.id) return;
    setLoading(true);
    setError(null);
    setData(null);
    const qs = new URLSearchParams({
      player1: a.id,
      player2: b.id,
    });
    if (a.name) qs.set("name1", a.name);
    if (b.name) qs.set("name2", b.name);
    if (a.city) qs.set("city1", a.city);
    if (b.city) qs.set("city2", b.city);
    if (a.state) qs.set("state1", a.state);
    if (b.state) qs.set("state2", b.state);
    if (a.location) qs.set("location1", a.location);
    if (b.location) qs.set("location2", b.location);
    if (a.singlesUtr) qs.set("utr1", a.singlesUtr);
    if (b.singlesUtr) qs.set("utr2", b.singlesUtr);
    try {
      const d = await api(`/api/h2h?${qs}`);
      setData(d);
      setParams(qs, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [setParams]);

  useEffect(() => {
    if (player1?.id && player2?.id) load(player1, player2);
  }, [player1?.id, player2?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
          Pick any two players to see every recorded meeting — scores, events, and the overall head-to-head. Ranking
          trajectory overlays still live on{" "}
          <Link to="/compare" style={{ color: "var(--ball)" }}>
            Compare
          </Link>
          .
        </p>
      </section>

      <section className="panel">
        <h2>Pick players</h2>
        <div className="h2h-pick-grid">
          <PlayerPicker label="Player 1" value={player1} onChange={setPlayer1} />
          <div className="h2h-vs" aria-hidden>
            VS
          </div>
          <PlayerPicker label="Player 2" value={player2} onChange={setPlayer2} />
        </div>
        {player1 && player2 && (
          <div style={{ marginTop: 18 }}>
            <button className="btn solid" disabled={loading} onClick={() => load(player1, player2)}>
              {loading ? "Loading meetings…" : "Refresh head to head"}
            </button>
          </div>
        )}
      </section>

      {error && <div className="error-box">{error}</div>}

      {loading && !data && (
        <section className="panel">
          <div className="empty">
            <span className="spinner" /> Sweeping match results for both players…
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
            <p className="chart-note">Match results via {data.source}. Scores shown winner–loser by set.</p>
          </section>

          <section className="panel">
            <h2>Meetings ({filteredMatches.length})</h2>
            {filteredMatches.length === 0 ? (
              <div className="empty">
                No recorded meetings between these two in the available results
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
                      <th>Draw</th>
                      <th>Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatches.map((m, i) => (
                      <tr key={`${m.date}-${m.eventId}-${m.drawName}-${i}`}>
                        <td className="num">{fmtDate(m.date)}</td>
                        <td>
                          <span className={`tag ${m.player1Won ? "win" : "loss"}`}>
                            {m.winnerName}
                          </span>
                          <span className="result-meta" style={{ marginLeft: 8 }}>
                            {m.singles ? "Singles" : "Doubles"}
                          </span>
                        </td>
                        <td className="num">{m.score || "—"}</td>
                        <td>{m.drawName || "—"}</td>
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
                On published USTA lists where both appear:{" "}
                {niceName(data.rankingMeetings.player1.name)} ranked ahead{" "}
                {data.rankingMeetings.summary.player1Ahead}× ·{" "}
                {niceName(data.rankingMeetings.player2.name)} ahead{" "}
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
              {data.localPlayers?.player1 && data.localPlayers?.player2 && (
                <p className="chart-note">
                  Also chart trajectories on{" "}
                  <Link to="/compare" style={{ color: "var(--ball)" }}>
                    Compare
                  </Link>{" "}
                  after both histories are on file.
                </p>
              )}
            </section>
          )}

          {!data.rankingMeetings?.summary?.meetings && (
            <section className="panel">
              <h2>USTA ranking overlap</h2>
              <div className="empty" style={{ textAlign: "left", padding: "8px 0" }}>
                Build both players&apos; ranking histories from{" "}
                <Link to="/" style={{ color: "var(--ball)" }}>
                  Search
                </Link>{" "}
                to also see every published list where they appeared together.
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
