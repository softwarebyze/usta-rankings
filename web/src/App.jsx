import { Outlet, Link, NavLink } from "react-router-dom";

export default function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="wordmark">
          Baseline<span className="dot">.</span>
        </Link>
        <nav>
          <NavLink to="/" end>
            Search
          </NavLink>
          <NavLink to="/compare">Compare</NavLink>
        </nav>
      </header>
      <Outlet />
      <footer className="colophon">
        Ranking data scraped live from{" "}
        <a href="https://tennislink.usta.com/tournaments/rankings/rankinghome.aspx" target="_blank" rel="noreferrer">
          USTA TennisLink
        </a>{" "}
        (2001–present). Singles, doubles &amp; combined lists as published. Lower rank = better; charts are inverted
        so climbing the rankings points up.
      </footer>
    </div>
  );
}
