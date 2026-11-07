export const AGE_COLORS = {
  10: "#9ad1ff",
  12: "#5fd0a5",
  14: "#d8e63a",
  16: "#e8b54a",
  18: "#e07a4f",
};

export function ageColor(ageGroup) {
  const n = parseInt(String(ageGroup).slice(1), 10);
  return AGE_COLORS[n] || "#c9c4b4";
}

export function ageLabel(ageGroup) {
  const g = ageGroup?.[0] === "G" ? "Girls'" : "Boys'";
  return `${g} ${String(ageGroup).slice(1)}s`;
}

export function niceName(name) {
  return String(name ?? "").includes(",")
    ? name.split(",").map((s) => s.trim()).reverse().join(" ")
    : name;
}

/** URL slug for a player name: "Plutt, Michael" → "michael-plutt" */
export function nameSlug(name) {
  return niceName(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function h2hSlug(name1, name2) {
  const a = nameSlug(name1);
  const b = nameSlug(name2);
  if (!a || !b) return "";
  return `${a}-vs-${b}`;
}

/** Human title from slug: "michael-plutt-vs-jourdan-kast" → "Michael Plutt vs Jourdan Kast" */
export function titleFromH2hSlug(slug) {
  const m = String(slug || "").match(/^(.+)-vs-(.+)$/i);
  if (!m) return null;
  const unslug = (s) =>
    s
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  return `${unslug(m[1])} vs ${unslug(m[2])}`;
}

export async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
