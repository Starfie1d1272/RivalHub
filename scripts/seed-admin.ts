import { randomBytes, scryptSync } from "crypto";
import pg from "pg";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const poolConfig: pg.PoolConfig & { family: number } = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: 4,
  };
  const pool = new pg.Pool(poolConfig);

  // Insert root admin（凭据只来自环境变量；与 src/db/seed.ts 同一契约）
  // - 两个变量都存在 → 创建（已存在则跳过）
  // - 只设置一个 → 配置错误，无论环境一律抛错
  // - 两个都不存在 → production 抛错（fail closed）；非 production 安全跳过
  const rootUsername = process.env.RIVALHUB_ROOT_USERNAME?.trim();
  const rootPassword = process.env.RIVALHUB_ROOT_PASSWORD;
  if (rootUsername || rootPassword) {
    if (!rootUsername || !rootPassword) {
      throw new Error(
        "RIVALHUB_ROOT_USERNAME and RIVALHUB_ROOT_PASSWORD must both be set (or both omitted)."
      );
    }
    const pwHash = hashPassword(rootPassword);
    const res = await pool.query(
      `INSERT INTO admin_users (username, password_hash, role)
       VALUES ($1, $2, 'super_admin')
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [rootUsername, pwHash],
    );
    if (res.rows.length > 0) {
      console.log(`Created root admin: ${rootUsername}`);
    } else {
      console.log("Root admin already exists");
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Production seed requires RIVALHUB_ROOT_USERNAME and RIVALHUB_ROOT_PASSWORD to be set."
    );
  } else {
    console.log(
      "Root admin seed skipped: set RIVALHUB_ROOT_USERNAME and RIVALHUB_ROOT_PASSWORD to create one."
    );
  }

  // Insert seasons
  for (const season of [
    {
      slug: "2026-nju-rivals",
      name: "2026 NJU Rivals",
      kind: "选秀联赛",
      status: "registration",
      themeColor: "#f97316",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      stagePlan: JSON.stringify([
        { key: "qualifier", name: "排位赛", type: "round_robin", teamCount: 8, advance: 8 },
        { key: "playoff", name: "正赛", type: "double_elim", teamCount: 8, advance: 1 },
      ]),
      registrationConfig: JSON.stringify({
        allowedPlayerTypes: ["enrolled"],
        rankThreshold: { currentMin: "A", peakMin: "A+" },
        maxPerPosition: 15,
        screenshotCount: 1,
      }),
      teamSize: 7,
      starterCount: 5,
      positions: "{igl,awper,opener,closer,anchor}",
    },
    {
      slug: "spring-2026-league",
      name: "2026 春季选秀联赛",
      kind: "联赛",
      status: "draft",
      themeColor: "#f97316",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      stagePlan: JSON.stringify([
        { key: "qualifier", name: "排位赛", type: "round_robin", teamCount: 8, advance: 8 },
        { key: "playoff", name: "正赛", type: "double_elim", teamCount: 8, advance: 1 },
      ]),
      registrationConfig: JSON.stringify({
        allowedPlayerTypes: ["enrolled"],
        rankThreshold: { currentMin: "A", peakMin: "A+" },
        maxPerPosition: 15,
        screenshotCount: 1,
      }),
      teamSize: 7,
      starterCount: 5,
      positions: "{igl,awper,opener,closer,anchor}",
    },
    {
      slug: "autumn-2026-open",
      name: "2026 秋季公开赛",
      kind: "杯赛",
      status: "draft",
      themeColor: "#ef4444",
      registrationMode: "team",
      hasCaptainVoting: false,
      hasDraft: false,
      stagePlan: JSON.stringify([
        { key: "qualifier", name: "排位赛", type: "round_robin", teamCount: 8, advance: 8 },
        { key: "playoff", name: "正赛", type: "double_elim", teamCount: 8, advance: 1 },
      ]),
      registrationConfig: JSON.stringify({
        allowedPlayerTypes: ["enrolled"],
        rankThreshold: { currentMin: "A", peakMin: "A+" },
        maxPerPosition: 15,
        screenshotCount: 1,
      }),
      teamSize: 5,
      starterCount: 5,
      positions: "{igl,awper,opener,closer,anchor}",
    },
  ]) {
    await pool.query(
      `INSERT INTO seasons (slug, name, kind, status, theme_color,
        registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_size, starter_count, positions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (slug) DO NOTHING`,
      [
        season.slug, season.name, season.kind, season.status,
        season.themeColor, season.registrationMode, season.hasCaptainVoting,
        season.hasDraft, season.stagePlan, season.registrationConfig,
        season.teamSize, season.starterCount, season.positions,
      ],
    );
  }
  console.log("Seasons seeded");

  await pool.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
