// Lightweight HTTP client for Universal Tennis (UTR) public player APIs.
// Used for head-to-head match history between any two players.
import { db } from "./db.js";

const SEARCH_URL = "https://api.utrsports.net/v2/search/players";
const RESULTS_URL = "https://app.utrsports.net/api/v1/player";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const MIN_YEAR = 2005;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

async function utrFetch(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`UTR ${res.status}: ${text.slice(0, 180) || res.statusText}`);
  }
  return res.json();
}

function mapHit(hit) {
  const s = hit?.source ?? hit ?? {};
  const loc = s.location || {};
  return {
    id: String(s.id ?? hit.id),
    profileId: s.profileId ?? null,
    name: s.displayName || `${s.firstName || s.playerFirstName || ""} ${s.lastName || s.playerLastName || ""}`.trim(),
    firstName: s.firstName || s.playerFirstName || null,
    lastName: s.lastName || s.playerLastName || null,
    gender: s.gender || null,
    location: loc.display || [loc.cityName, loc.stateName].filter(Boolean).join(", ") || null,
    city: loc.cityName || s.city || null,
    state: loc.stateName || s.state || null,
    singlesUtr: s.singlesUtrDisplay || (s.singlesUtr != null ? String(s.singlesUtr) : null),
    doublesUtr: s.doublesUtrDisplay || (s.doublesUtr != null ? String(s.doublesUtr) : null),
  };
}

/** Search UTR players by name. */
export async function searchUtrPlayers(query, { top = 20 } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  const url = `${SEARCH_URL}?query=${encodeURIComponent(q)}&top=${top}`;
  const data = await utrFetch(url);
  return (data.hits || []).map(mapHit);
}

function cacheGet(playerId, yearKey) {
  const row = db
    .prepare(`SELECT payload, fetched_at FROM utr_results_cache WHERE player_id = ? AND year_key = ?`)
    .get(String(playerId), String(yearKey));
  if (!row) return null;
  // SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS"
  const fetchedMs = Date.parse(String(row.fetched_at).replace(" ", "T") + "Z");
  if (Number.isFinite(fetchedMs) && Date.now() - fetchedMs > CACHE_TTL_MS) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function cacheSet(playerId, yearKey, payload) {
  db.prepare(
    `INSERT INTO utr_results_cache (player_id, year_key, payload, fetched_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(player_id, year_key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at`
  ).run(String(playerId), String(yearKey), JSON.stringify(payload));
}

async function fetchResultsYear(playerId, year) {
  const yearKey = year == null ? "all" : String(year);
  const cached = cacheGet(playerId, yearKey);
  if (cached) return cached;
  let url = `${RESULTS_URL}/${playerId}/results`;
  if (year != null) url += `?year=${year}`;
  const data = await utrFetch(url);
  cacheSet(playerId, yearKey, data);
  return data;
}

function formatScore(score) {
  if (!score) return "";
  if (typeof score === "string") return score;
  const parts = [];
  for (const k of Object.keys(score).sort((a, b) => Number(a) - Number(b))) {
    const s = score[k];
    if (!s || typeof s !== "object" || s.winner == null) continue;
    const tb = s.tiebreak ?? s.winnerTiebreak;
    const left = s.winner;
    const right = s.loser ?? "";
    parts.push(`${left}-${right}${tb != null ? `(${tb})` : ""}`);
  }
  return parts.join(" ");
}

function playerIdsInResult(res) {
  const players = res?.players || {};
  const out = [];
  for (const role of ["winner1", "winner2", "loser1", "loser2"]) {
    const p = players[role];
    if (p?.id != null) out.push({ role, id: String(p.id), player: p });
  }
  return out;
}

function isSingles(res) {
  const players = res?.players || {};
  return !players.winner2 && !players.loser2;
}

function flattenMatches(resultsPayload, selfId) {
  const self = String(selfId);
  const matches = [];
  for (const ev of resultsPayload?.events || []) {
    for (const draw of ev.draws || []) {
      for (const res of draw.results || []) {
        const ids = playerIdsInResult(res);
        if (!ids.some((x) => x.id === self)) continue;
        const winnerIds = new Set(
          ids.filter((x) => x.role.startsWith("winner")).map((x) => x.id)
        );
        matches.push({
          matchId: res.id ?? null,
          date: (res.date || "").slice(0, 10) || null,
          eventId: ev.id ?? null,
          eventName: ev.name || null,
          drawName: draw.name || null,
          score: formatScore(res.score),
          outcome: res.outcome || null,
          singles: isSingles(res),
          selfWon: winnerIds.has(self),
          players: ids.map(({ role, id, player }) => ({
            role,
            id,
            name: `${player.firstName || ""} ${player.lastName || ""}`.trim(),
            firstName: player.firstName || null,
            lastName: player.lastName || null,
          })),
        });
      }
    }
  }
  return matches;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/** Fetch a player's matches across years (cached). */
export async function getPlayerMatches(playerId, { fromYear = MIN_YEAR, toYear = new Date().getFullYear() } = {}) {
  const years = [null, ...Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i)];
  const payloads = await mapPool(years, 4, (year) => fetchResultsYear(playerId, year));
  const byKey = new Map();
  for (const payload of payloads) {
    for (const m of flattenMatches(payload, playerId)) {
      const key = `${m.date}|${m.eventId}|${m.drawName}|${m.score}|${m.players.map((p) => p.id).sort().join(",")}`;
      if (!byKey.has(key)) byKey.set(key, m);
    }
  }
  return [...byKey.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function summarizePlayer(p) {
  return {
    id: String(p.id),
    name: p.name,
    location: p.location,
    city: p.city,
    state: p.state,
    singlesUtr: p.singlesUtr,
    doublesUtr: p.doublesUtr,
    gender: p.gender,
  };
}

function profileFromMatches(selfId, matches, hint) {
  if (hint?.name) return summarizePlayer({ id: selfId, ...hint });
  for (const m of matches) {
    const me = m.players.find((p) => p.id === selfId);
    if (me?.name) {
      return {
        id: selfId,
        name: me.name,
        location: null,
        city: null,
        state: null,
        singlesUtr: null,
        doublesUtr: null,
        gender: null,
      };
    }
  }
  return {
    id: selfId,
    name: `Player ${selfId}`,
    location: null,
    city: null,
    state: null,
    singlesUtr: null,
    doublesUtr: null,
    gender: null,
  };
}

/**
 * Head-to-head match history between two UTR player IDs.
 * Fetches both sides and merges for completeness.
 * Optional profile hints (from prior search) enrich display names/locations.
 */
export async function computeH2H(player1Id, player2Id, { profile1 = null, profile2 = null } = {}) {
  const a = String(player1Id);
  const b = String(player2Id);
  if (a === b) throw new Error("Pick two different players");

  const [matchesA, matchesB] = await Promise.all([getPlayerMatches(a), getPlayerMatches(b)]);

  const player1 = profileFromMatches(a, matchesA, profile1);
  const player2 = profileFromMatches(b, matchesB, profile2);

  const h2hKeys = new Map();
  function consider(match) {
    const ids = new Set(match.players.map((p) => p.id));
    if (!ids.has(a) || !ids.has(b)) return;
    const key = `${match.date}|${match.eventId}|${match.drawName}|${match.score}|${[...ids].sort().join(",")}`;
    if (h2hKeys.has(key)) return;
    const winnerIds = new Set(match.players.filter((p) => p.role.startsWith("winner")).map((p) => p.id));
    const player1Won = winnerIds.has(a);
    h2hKeys.set(key, {
      date: match.date,
      eventName: match.eventName,
      eventId: match.eventId,
      drawName: match.drawName,
      score: match.score,
      outcome: match.outcome,
      singles: match.singles,
      winnerId: player1Won ? a : b,
      winnerName: player1Won ? player1.name : player2.name,
      player1Won,
    });
  }

  for (const m of matchesA) consider(m);
  for (const m of matchesB) consider(m);

  const matches = [...h2hKeys.values()].sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const singles = matches.filter((m) => m.singles);
  const doubles = matches.filter((m) => !m.singles);

  const recordFor = (list) => {
    const p1 = list.filter((m) => m.player1Won).length;
    const p2 = list.length - p1;
    return { player1Wins: p1, player2Wins: p2, meetings: list.length };
  };

  return {
    player1,
    player2,
    record: recordFor(matches),
    singlesRecord: recordFor(singles),
    doublesRecord: recordFor(doubles),
    matches,
    source: "UTR Sports",
  };
}
