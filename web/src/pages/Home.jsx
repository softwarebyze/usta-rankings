import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib.js";
import { getRecents } from "../recents.js";

export default function Home() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [recents, setRecents] = useState([]);
  const [starting, setStarting] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    setRecents(getRecents());
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

  return (
    <>
      <section className="hero">
        <h1>
          Every ranking you<br />
          ever earned. <em>One chart.</em>
        </h1>
        <p className="lede">
          Search the USTA junior ranking archive by name, and we'll dig through two decades of published sectional
          and national standing lists to rebuild a player's complete ranking history — by age bracket, over time.
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
            <>Searches every published ranking year from 2001 to today.</>
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

      {recents.length > 0 && (
        <section className="panel">
          <h2>Recently viewed</h2>
          {recents.map((p) => (
            <div className="result-row" key={p.id}>
              <div>
                <div className="result-name">
                  <Link to={`/player/${p.id}`} style={{ color: "inherit" }}>
                    {p.name}
                  </Link>
                </div>
                <div className="result-meta">{[p.city, p.state].filter(Boolean).join(", ")}</div>
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
