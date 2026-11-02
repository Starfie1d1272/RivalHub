// Public targets for the official hosted instance; never put credentials here.
const production = {
  origin: "https://match.starfie1d.top",
  projectRef: "ggkxqgbiudlovcgizgsq",
  poolerHost: "aws-0-ap-northeast-1.pooler.supabase.com",
  poolerPort: "6543",
  sessionPoolerPort: "5432",
};
const preview = {
  projectRef: "dtdzxnzjtohzjmfkighg",
  poolerHost: "aws-0-ap-northeast-1.pooler.supabase.com",
  poolerPort: "6543",
};

for (const profile of [production, preview]) {
  if (!/^[a-z]{20}$/.test(profile.projectRef)
    || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(profile.poolerHost)
    || !/^\d+$/.test(profile.poolerPort)) throw new Error("Invalid official deployment profile.");
}
const origin = new URL(production.origin);
if (origin.protocol !== "https:" || origin.origin !== production.origin || origin.username || origin.password
  || !/^\d+$/.test(production.sessionPoolerPort) || production.projectRef === preview.projectRef) {
  throw new Error("Invalid official deployment profile.");
}
export const OFFICIAL_PRODUCTION = Object.freeze({ ...production, supabaseUrl: `https://${production.projectRef}.supabase.co` });
export const OFFICIAL_PREVIEW = Object.freeze({ ...preview, supabaseUrl: `https://${preview.projectRef}.supabase.co` });
