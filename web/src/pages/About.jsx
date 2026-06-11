import { Link } from "react-router-dom";

const TENNISLINK = "https://tennislink.usta.com/tournaments/rankings/rankinghome.aspx";

export default function About() {
  return (
    <div className="prose">
      <section className="hero" style={{ paddingBottom: 10 }}>
        <h1>
          About <em>Baseline</em>.
        </h1>
        <p className="lede">
          Baseline rebuilds the complete USTA junior ranking history of any player — every published list, every age
          bracket, two decades deep — and puts it on one chart.
        </p>
      </section>

      <section className="panel">
        <h2>What this site is</h2>
        <p>
          The USTA has published junior ranking lists since 2001 on{" "}
          <a href={TENNISLINK} target="_blank" rel="noreferrer">
            TennisLink
          </a>
          , but the archive is built for looking up <i>one list at a time</i>. There is no way to see a player's
          trajectory: how they climbed through the 10s, peaked in the 12s, aged up to the 14s, and so on. Baseline
          fills that gap. You search a name, and it digs through every relevant published list to reconstruct the full
          picture.
        </p>
        <p>
          Nothing here is estimated, modeled, or interpolated. Every data point is a rank that the USTA actually
          published, read directly from the original list — and every snapshot links back to its source.
        </p>
      </section>

      <section className="panel">
        <h2>Where the data comes from</h2>
        <p>
          All data comes from the official{" "}
          <a href={TENNISLINK} target="_blank" rel="noreferrer">
            USTA TennisLink ranking archive
          </a>
          . When you build a player's history, Baseline:
        </p>
        <ol>
          <li>
            <b>Finds the player.</b> It sweeps the archive's player search for every ranking year from 2001 to today,
            which tells us the exact years the player was ranked and gives us their stable USTA identifier.
          </li>
          <li>
            <b>Discovers the lists.</b> For each active year, it enumerates every junior ranking list the USTA
            published for the player's section (e.g. Florida) and at National level — every age bracket, singles and
            doubles. A single season can have 600+ published lists.
          </li>
          <li>
            <b>Reads each list.</b> It opens each candidate list, looks the player up by name, and records the exact
            rank, points, and district as published — along with the list's publication date.
          </li>
        </ol>
        <p>
          To keep this fast, the scan is pruned with simple tennis logic: players never age <i>down</i> a bracket, a
          player found on boys' lists won't appear on girls' lists, and national lists are only checked for seasons
          where a sectional ranking exists. Several scanning sessions run in parallel, but requests are deliberately
          rate-limited to be gentle on the USTA's servers. A full career takes a few minutes to reconstruct; after
          that it's stored and loads instantly.
        </p>
      </section>

      <section className="panel">
        <h2>Reading the data</h2>
        <h3>List types</h3>
        <ul>
          <li>
            <b>Standing List</b> — the raw points standings at a point in time.
          </li>
          <li>
            <b>Tentative Ranking</b> — the ranking as it would be if the season ended that day. Published periodically
            through the season (often twice a month).
          </li>
          <li>
            <b>Final Ranking</b> — the official year-end ranking for that season and bracket.
          </li>
          <li>
            <b>Endorsement / Seeding / Selection lists</b> — special-purpose lists used for tournament entry and
            seeding.
          </li>
        </ul>
        <h3>Scope</h3>
        <ul>
          <li>
            <b>Sectional</b> — ranks players within their USTA section (e.g. all of Florida). This is the "state
            ranking" most juniors remember.
          </li>
          <li>
            <b>National</b> — USTA national-level lists.
          </li>
        </ul>
        <h3>Disciplines</h3>
        <ul>
          <li>
            <b>Singles</b> and <b>Doubles</b> — lists ranked on that discipline's points alone.
          </li>
          <li>
            <b>Combined</b> — lists ranked on combined singles + doubles points. In many seasons (especially 2008
            onward) the combined list is the primary published ranking, and per-discipline lists were dropped.
          </li>
        </ul>
        <p>
          Career-best cards show the best singles-or-combined rank per bracket, with the doubles best noted
          underneath; on the chart, doubles series are dashed.
        </p>
        <h3>The chart</h3>
        <p>
          The y-axis is inverted — #1 sits at the top — so a line moving <i>up</i> means climbing the rankings. Colors
          encode age brackets (10s through 18s). Filters let you slice by bracket, variant, list type, and discipline.
        </p>
      </section>

      <section className="panel">
        <h2>Coverage &amp; honest caveats</h2>
        <ul>
          <li>
            <b>2001–present.</b> The TennisLink archive starts in 2001. Earlier results don't exist there.
          </li>
          <li>
            <b>Published lists only.</b> If the USTA didn't publish it on TennisLink, it isn't here. Some sections ran
            their own ranking systems (especially for younger age groups) outside TennisLink — for example
            district/region-level lists or section-run "designated" rankings. A rank you remember from a section
            website, a trophy, or a tournament program may come from one of those systems.
          </li>
          <li>
            <b>Names can shift.</b> The USTA occasionally re-registered players; if a player appears under two
            spellings, each is a separate search result.
          </li>
          <li>
            <b>Point-in-time truth.</b> Each snapshot reflects the list as published on that date. Tentative rankings
            fluctuate by design; the Final Ranking is the official year-end word.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>Verifying any number</h2>
        <p>
          Every row in a player's snapshot table has a <b>USTA ↗</b> link that opens the original published list on
          TennisLink. If you ever doubt a number, click through and check the source — that's the whole point.
        </p>
      </section>

      <section className="panel">
        <h2>How it's built</h2>
        <p>
          TennisLink is a legacy ASP.NET WebForms application. Rather than driving a headless browser, Baseline
          reverse-engineered its postback protocol and talks to it with plain HTTP — maintaining the form viewstate
          across requests exactly as a browser would. The backend is Node.js + Express with a SQLite store; the
          frontend is React with Recharts. Share links render a custom Open Graph card with the player's
          career-best ranks per bracket.
        </p>
        <p>
          Found something off, or want your history built?{" "}
          <Link to="/">Search your name</Link> — it's the same pipeline for everyone.
        </p>
      </section>
    </div>
  );
}
