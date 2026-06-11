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
          <NavLink to="/pricing">Pricing</NavLink>
          <NavLink to="/about">About</NavLink>
        </nav>
      </header>
      <Outlet />
      <footer className="colophon">
        <p>
          Every number on this site is read directly from ranking lists published on{" "}
          <a href="https://tennislink.usta.com/tournaments/rankings/rankinghome.aspx" target="_blank" rel="noreferrer">
            USTA TennisLink
          </a>{" "}
          (2001–present) — sectional &amp; national junior singles and doubles lists, exactly as published. Each
          snapshot links back to its original list. Lower rank = better; charts are inverted so climbing the rankings
          points up. <Link to="/about">How it works →</Link>
        </p>
      </footer>
    </div>
  );
}
