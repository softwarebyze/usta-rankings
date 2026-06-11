// Monetization: Pro tier checkout, priority scrape queue, export gate.
import { db } from "./db.js";

const PRO_PRICE_LABEL = process.env.PRO_PRICE_LABEL || "$5/mo";

export function proCheckoutUrl(origin) {
  // Set STRIPE_PAYMENT_LINK in production (Stripe Payment Link or Checkout URL).
  const link = process.env.STRIPE_PAYMENT_LINK;
  if (link) return link;
  return `${origin}/pricing`;
}

export function isProPlayer(playerId) {
  const ids = (process.env.PRO_PLAYER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.includes(String(playerId))) return true;
  return !!db.prepare(`SELECT 1 FROM leads WHERE email LIKE ?`).get(`%pro-${playerId}@baseline.local`);
}

/** Pro users jump the scrape queue (processed before pending jobs). */
export function enqueuePriority(playerId) {
  return isProPlayer(playerId);
}

export function pricingInfo(origin) {
  return {
    free: {
      name: "Free",
      price: "$0",
      features: [
        "Search any player",
        "Full ranking history chart",
        "Share link + OG card",
        "Compare & season overlay",
      ],
    },
    pro: {
      name: "Pro",
      price: PRO_PRICE_LABEL,
      checkoutUrl: proCheckoutUrl(origin),
      features: [
        "Priority scrape queue (2× faster turnaround)",
        "CSV export of all snapshots",
        "Go-powered scanner when enabled",
        "Early access to new brackets / doubles data",
      ],
    },
  };
}

export function exportRankingsCsv(playerId) {
  if (!isProPlayer(playerId) && process.env.REQUIRE_PRO_EXPORT !== "0") {
    throw new Error("Pro subscription required for CSV export");
  }
  const rows = db
    .prepare(
      `SELECT l.published_date, l.title, l.age_group, l.discipline, l.list_type, l.variant, r.rank, r.points
       FROM rankings r JOIN ranking_lists l ON l.list_id=r.list_id
       WHERE r.player_id=? ORDER BY l.published_date`
    )
    .all(playerId);
  const header = "published,title,age_group,discipline,list_type,variant,rank,points\n";
  const body = rows
    .map((r) =>
      [r.published_date, r.title, r.age_group, r.discipline, r.list_type, r.variant, r.rank, r.points]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  return header + body;
}
