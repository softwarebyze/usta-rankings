// Multi-year player search: sweeps the archive year by year using a few
// parallel sessions, merging results by the player's stable encrypted token.
import { UstaSession, searchPlayersForYear } from "./usta.js";
import { MIN_YEAR } from "./constants.js";

const CURRENT_YEAR = new Date().getFullYear();
const PARALLEL = 6;

export async function searchPlayerAllYears(name) {
  const years = [];
  for (let y = CURRENT_YEAR; y >= MIN_YEAR; y--) years.push(y);

  const chunks = Array.from({ length: PARALLEL }, () => []);
  years.forEach((y, i) => chunks[i % PARALLEL].push(y));

  const merged = new Map();
  await Promise.all(
    chunks.map(async (chunk) => {
      const session = new UstaSession();
      await session.init();
      for (const year of chunk) {
        let players = [];
        try {
          players = await searchPlayersForYear(session, name, year);
        } catch {
          try {
            await session.init();
            players = await searchPlayersForYear(session, name, year);
          } catch {
            // skip year on repeated failure
          }
        }
        for (const p of players) {
          const cur = merged.get(p.token);
          if (cur) cur.years.push(year);
          else merged.set(p.token, { token: p.token, name: p.name, city: p.city, state: p.state, years: [year] });
        }
      }
    })
  );

  return [...merged.values()]
    .map((p) => ({ ...p, years: p.years.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
