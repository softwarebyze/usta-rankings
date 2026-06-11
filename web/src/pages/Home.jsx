import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, niceName } from "../lib.js";

const FEATURES = [
  {
    title: "Every list, one chart",
    body: "Two decades of published standing, tentative and final ranking lists — singles and doubles — rebuilt into a single trajectory per age bracket.",
  },
  {
    title: "Career-best, instantly",
    body: "Your peak rank in the 10s, 12s, 14s, 16s and 18s, surfaced as cards the moment the history is built. No more digging through one list at a time.",
  },
  {
    title: "Straight from the source",
    body: "Nothing is estimated. Every snapshot is read from the official USTA TennisLink archive, and every row links back to the original published list.",
  },
  {
    title: "Compare across eras",
    body: "Overlay any players — or your own seasons — on one chart. Season overlay lines up different calendar years so a 2007 run and a 2016 run compare directly.",
  },
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [players, setPlayers] = useState([]);
  const [starting, setStarting] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api("/api/players").then((d) => setPlayers(d.players)).catch(() => {});
  }, []);

  async function onSearch(e) {
    e.preventDefault();
    if (query.trim().length < 2 || searching) return;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const d = await api("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: query.trim() }),
      });
      setResults(d.players);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function track(p) {
    setStarting(p.token);
    try {
      const d = await api("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      navigate(`/player/${d.playerId}`);
    } catch (err) {
      setError(err.message);
      setStarting(null);
    }
  }

  const demo = players.find((p) => p.snapshots > 0);

  return (
    <>
      <section className="hero">
        <h1>
          Every ranking you<br />
          ever earned. <em>One chart.</em>
        </h1>
        <p className="lede">
          Search the USTA junior ranking archive by name, and we'll dig through two decades of published sectional
          and national lists to rebuild a player's complete ranking history — by age bracket, over time.
        </p>
        <form className="searchbox" onSubmit={onSearch}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Last name, or “First Last” — e.g. Ebenfeld"
            autoFocus
          />
          <button disabled={searching}>{searching ? "Sweeping…" : "Search"}</button>
        </form>
        <p className="search-hint">
          {searching ? (
            <>
              <b>Sweeping the archive year by year (2001–present)…</b> this takes ~10 seconds.
            </>
          ) : (
            <>
              Searches every published ranking year from 2001 to today.
              {demo && (
                <>
                  {" "}
                  Or <Link to={`/player/${demo.id}`}>see a live example →</Link>
                </>
              )}
            </>
          )}
        </p>
      </section>

      {error && <div className="error-box">{error}</div>}

      {results && (
        <section className="panel">
          <h2>Matches ({results.length})</h2>
          {results.length === 0 && (
            <div className="empty">No players found in the archive under that name. Try last name only.</div>
          )}
          {results.map((p) => (
            <div className="result-row" key={p.token}>
              <div>
                <div className="result-name">{p.name}</div>
                <div className="result-meta">
                  {p.city}, {p.state}
                </div>
                <div className="result-years">Ranked in: {p.years.join(" · ")}</div>
              </div>
              <button className="btn solid" onClick={() => track(p)} disabled={starting === p.token}>
                {starting === p.token ? "Starting…" : "Build history →"}
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="features">
        {FEATURES.map((f) => (
          <div className="feature-card" key={f.title}>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </section>

      <section className="how">
        <h2>How it works</h2>
        <div className="how-steps">
          <div className="how-step">
            <div className="how-num">1</div>
            <h4>Search a name</h4>
            <p>We sweep the official archive's player search across every ranking year since 2001.</p>
          </div>
          <div className="how-step">
            <div className="how-num">2</div>
            <h4>We read every list</h4>
            <p>
              Hundreds of published ranking lists per season are checked for the player — every bracket, singles and
              doubles, sectional and national.
            </p>
          </div>
          <div className="how-step">
            <div className="how-num">3</div>
            <h4>One shareable chart</h4>
            <p>
              The full trajectory with career-bests per bracket — and a share card built in. Every number links back
              to its original USTA list.
            </p>
          </div>
        </div>
        <p className="how-more">
          <Link to="/about">Read the full methodology →</Link>
        </p>
      </section>

      {players.length > 0 && (
        <section className="panel">
          <h2>Players on file</h2>
          {players.map((p) => (
            <div className="result-row" key={p.id}>
              <div>
                <div className="result-name">
                  <Link to={`/player/${p.id}`} style={{ color: "inherit" }}>
                    {niceName(p.name)}
                  </Link>
                </div>
                <div className="result-meta">
                  {p.city}, {p.state} — {p.snapshots} ranking snapshots
                  {p.last_job_status === "running" && " · scraping now…"}
                </div>
              </div>
              <Link className="btn small" to={`/player/${p.id}`}>
                View
              </Link>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
