import { useEffect, useState } from "react";
import { api } from "../lib.js";

export default function Pricing() {
  const [plans, setPlans] = useState(null);

  useEffect(() => {
    api("/api/pricing").then(setPlans).catch(() => {});
  }, []);

  if (!plans) return <div className="empty"><span className="spinner" /> Loading…</div>;

  return (
    <>
      <section className="hero" style={{ paddingBottom: 10 }}>
        <h1>
          Simple <em>pricing</em>.
        </h1>
        <p className="lede">
          Search and chart any player's USTA history for free. Pro unlocks faster scrapes, CSV export, and priority
          when the archive is busy.
        </p>
      </section>
      <div className="pricing-grid">
        {[plans.free, plans.pro].map((p) => (
          <div className={`pricing-card ${p.name === "Pro" ? "pro" : ""}`} key={p.name}>
            <h2>{p.name}</h2>
            <div className="price">{p.price}</div>
            <ul>
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {p.checkoutUrl ? (
              <a className="btn solid" href={p.checkoutUrl} target="_blank" rel="noreferrer">
                Upgrade →
              </a>
            ) : (
              <span className="btn" style={{ opacity: 0.7, cursor: "default" }}>
                Included
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="chart-note" style={{ marginTop: 24 }}>
        Set <code>STRIPE_PAYMENT_LINK</code> in production to enable checkout. Pro access is granted via{" "}
        <code>PRO_PLAYER_IDS</code> or Stripe webhook (wire when ready).
      </p>
    </>
  );
}
