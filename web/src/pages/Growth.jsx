import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib.js";

export default function Growth() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api("/api/marketing/stats").then(setStats).catch(() => {});
  }, []);

  if (!stats) return <div className="empty"><span className="spinner" /> Loading…</div>;

  return (
    <>
      <section className="hero" style={{ paddingBottom: 10 }}>
        <h1>
          Growth <em>dashboard</em>.
        </h1>
        <p className="lede">Automated funnel: referral links → profile views → shares → scrape starts → leads → Pro.</p>
      </section>
      <div className="growth-stats">
        <div className="growth-stat">
          <div className="num">{stats.players}</div>
          <div className="label">Players built</div>
        </div>
        <div className="growth-stat">
          <div className="num">{stats.scrapes}</div>
          <div className="label">Scrape starts</div>
        </div>
        <div className="growth-stat">
          <div className="num">{stats.shares}</div>
          <div className="label">Share events</div>
        </div>
        <div className="growth-stat">
          <div className="num">{stats.leads}</div>
          <div className="label">Email leads</div>
        </div>
      </div>
      <section className="panel">
        <h2>Event breakdown</h2>
        <table className="snapshots">
          <thead>
            <tr>
              <th>Event</th>
              <th style={{ textAlign: "right" }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {stats.events.map((e) => (
              <tr key={e.event_type}>
                <td>{e.event_type}</td>
                <td className="num" style={{ textAlign: "right" }}>
                  {e.c}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Automations</h2>
        <ul className="auto-list">
          <li>
            <b>Referral links</b> — <code>/r/p{'{playerId}'}</code> or <code>?ref=p{'{id}'}</code> on any URL; tracked
            on click and scrape.
          </li>
          <li>
            <b>OG share cards</b> — every player page unfurls with career-best ranks; copy via Share button or{" "}
            <code>GET /api/players/:id/social</code> for tweet/LinkedIn text.
          </li>
          <li>
            <b>Email capture</b> — landing page waitlist stored in <code>leads</code>; export for Mailchimp/ConvertKit.
          </li>
          <li>
            <b>Pro checkout</b> — <Link to="/pricing">/pricing</Link> + Stripe Payment Link env var; CSV export gated.
          </li>
          <li>
            <b>SEO</b> — <a href="/sitemap.xml">/sitemap.xml</a> and <a href="/robots.txt">/robots.txt</a> auto-generated.
          </li>
        </ul>
      </section>
    </>
  );
}
