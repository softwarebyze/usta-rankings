export const BASE_URL = "https://tennislink.usta.com/tournaments/rankings/rankinghome.aspx";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// SectionDistrict dropdown values on the USTA ranking search page
export const SECTIONS = {
  "05": "Caribbean",
  10: "Eastern",
  15: "Florida",
  20: "Hawaii Pacific",
  25: "Intermountain",
  30: "Mid-Atlantic",
  35: "Middle States",
  85: "Midwest",
  40: "Missouri Valley",
  "00": "National",
  45: "New England",
  50: "No. California",
  55: "Northern",
  60: "Pacific Northwest",
  65: "So. California",
  70: "Southern",
  75: "Southwest",
  80: "Texas",
};

// Which USTA section(s) a US state belongs to (for scoping the list search)
export const STATE_TO_SECTIONS = {
  AL: ["70"], AR: ["70"], GA: ["70"], KY: ["70"], LA: ["70"], MS: ["70"], NC: ["70"], SC: ["70"], TN: ["70"],
  FL: ["15"],
  NY: ["10"], CT: ["45", "10"], NJ: ["10", "35"],
  PA: ["35"], DE: ["35"],
  MD: ["30"], VA: ["30"], WV: ["30"], DC: ["30"],
  MA: ["45"], NH: ["45"], VT: ["45"], RI: ["45"], ME: ["45"],
  OH: ["85"], MI: ["85"], IN: ["85"], IL: ["85"], WI: ["85"],
  MN: ["55"], ND: ["55"], SD: ["55"],
  IA: ["40"], KS: ["40"], MO: ["40"], NE: ["40"], OK: ["40"],
  TX: ["80"],
  CO: ["25"], ID: ["25", "60"], MT: ["25"], NV: ["25", "65"], UT: ["25"], WY: ["25"],
  AZ: ["75"], NM: ["75"],
  CA: ["65", "50"],
  OR: ["60"], WA: ["60"], AK: ["60"],
  HI: ["20"],
  PR: ["05"], VI: ["05"],
};

// Junior singles divisions (Division dropdown values)
export const JUNIOR_DIVISIONS = {
  B: [
    { code: "D1001", label: "Boys' 18 Singles", ageGroup: "B18" },
    { code: "D1003", label: "Boys' 16 Singles", ageGroup: "B16" },
    { code: "D1005", label: "Boys' 14 Singles", ageGroup: "B14" },
    { code: "D1007", label: "Boys' 12 Singles", ageGroup: "B12" },
    { code: "D1009", label: "Boys' 10 Singles", ageGroup: "B10" },
  ],
  G: [
    { code: "D1015", label: "Girls' 18 Singles", ageGroup: "G18" },
    { code: "D1017", label: "Girls' 16 Singles", ageGroup: "G16" },
    { code: "D1019", label: "Girls' 14 Singles", ageGroup: "G14" },
    { code: "D1021", label: "Girls' 12 Singles", ageGroup: "G12" },
    { code: "D1023", label: "Girls' 10 Singles", ageGroup: "G10" },
  ],
};

export const MIN_YEAR = 2001;

export const REQUEST_DELAY_MS = 350;
