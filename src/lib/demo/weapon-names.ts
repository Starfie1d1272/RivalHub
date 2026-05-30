const WEAPON_LABELS: Record<string, string> = {
  "AK-47": "AK47",
  "ak47": "AK47",
  "M4A4": "M4A4",
  "m4a4": "M4A4",
  "M4A1-S": "M4A1",
  "m4a1_silencer": "M4A1",
  "AWP": "AWP",
  "awp": "AWP",
  "SSG 08": "SSG 08",
  "Desert Eagle": "Deagle",
  "Glock-18": "Glock",
  "USP-S": "USP",
  "P2000": "P2000",
  "P250": "P250",
  "Five-SeveN": "FN57",
  "Tec-9": "Tec-9",
  "CZ75-Auto": "CZ75",
  "Dual Berettas": "双枪",
  "MAC-10": "MAC-10",
  "MP9": "MP9",
  "MP7": "MP7",
  "MP5-SD": "MP5",
  "UMP-45": "UMP45",
  "P90": "P90",
  "PP-Bizon": "野牛",
  "FAMAS": "FAMAS",
  "Galil AR": "Galil",
  "SG 553": "SG553",
  "AUG": "AUG",
  "MAG-7": "MAG-7",
  "Nova": "Nova",
  "XM1014": "XM1014",
  "M249": "M249",
  "Negev": "Negev",
  "Zeus x27": "Zeus",
  "Molotov": "Molotov",
  "Flashbang": "Flash",
  "HE Grenade": "HE",
  "Smoke Grenade": "Smoke",
};

export function displayWeaponName(raw: string): string {
  return WEAPON_LABELS[raw] ?? raw;
}

/**
 * raw 武器码（小写，如 ak47/awp/m4a1_silencer）→ 完整展示名。
 * 用于 season 武器统计（weapons[].weapon 为 raw 码）的榜单/画像展示。
 */
const WEAPON_FULL_NAMES: Record<string, string> = {
  ak47: "AK-47",    m4a4: "M4A4",          m4a1: "M4A1-S",
  awp: "AWP",        m4a1_silencer: "M4A1-S", deserteagle: "Desert Eagle",
  usp: "USP-S",      glock: "Glock-18",
  deagle: "Desert Eagle",
  famas: "FAMAS",    galil: "Galil AR",
  mp9: "MP9",        mp7: "MP7",
  p250: "P250",      fiveseven: "Five-SeveN",
  tec9: "Tec-9",     cz75: "CZ75-Auto",
  ssg08: "SSG 08",   scar20: "SCAR-20",     g3sg1: "G3SG1",
  mac10: "MAC-10",   ump45: "UMP-45",
  p90: "P90",        bizon: "PP-Bizon",
  nova: "Nova",      xm1014: "XM1014",      mag7: "MAG-7",
  m249: "M249",      negev: "Negev",
  aug: "AUG",        sg556: "SG 553",
  elite: "Dual Berettas",
  knife: "刀",        taser: "电击枪",
  hegrenade: "HE 手雷",
  molotov: "燃烧弹",   incgrenade: "燃烧弹",
};

export function weaponFullName(raw: string): string {
  return WEAPON_FULL_NAMES[raw.toLowerCase()] ?? raw;
}
