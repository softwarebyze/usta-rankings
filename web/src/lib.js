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

export function sourceUrl(listId, rowP) {
  const base = "https://tennislink.usta.com/tournaments/rankings/rankinghome.aspx";
  if (rowP != null) {
    return `${base}?Page=PlayerRecord&id=${listId}&p=${rowP}&Type=searchresults#&&s=4\\Page_RankingList\\ListID_${listId}\\PlayerID_${rowP}\\Year_\\Type_searchresults`;
  }
  return `${base}#&&s=2\\Page_RankingList\\ListID_${listId}`;
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
