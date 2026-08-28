const KEY = "baseline:recents";
const CAP = 12;

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && p.id);
  } catch {
    return [];
  }
}

export function getRecents() {
  return read();
}

/** Record a player this browser actually opened. Most-recent first; never stores TennisLink tokens. */
export function touchRecent(player) {
  if (!player?.id) return;
  const entry = {
    id: Number(player.id),
    name: player.name || "",
    city: player.city || "",
    state: player.state || "",
  };
  const next = [entry, ...read().filter((p) => Number(p.id) !== entry.id)].slice(0, CAP);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // quota / private mode — recents are best-effort
  }
}
