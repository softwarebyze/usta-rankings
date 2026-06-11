/** Shared name formatting for server modules. */
export function niceNameForDb(name) {
  return String(name ?? "").includes(",")
    ? name.split(",").map((s) => s.trim()).reverse().join(" ")
    : name;
}
