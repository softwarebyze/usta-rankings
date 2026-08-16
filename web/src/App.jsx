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
          <NavLink to="/h2h">H2H</NavLink>
          <NavLink to="/compare">Compare</NavLink>
        </nav>
      </header>
      <Outlet />
      <footer className="colophon">
        Ranking data scraped live from the USTA TennisLink ranking archive (2001–present). Match head-to-head uses
        recorded results from UTR Sports. Rankings shown are sectional &amp; national junior singles standings as
        published. Lower rank = better; charts are inverted so climbing the rankings points up.
      </footer>
    </div>
  );
}
