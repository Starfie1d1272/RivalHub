import { db } from "../../src/db/client-runtime";
import { seasons } from "../../src/db/schema";
import { createMajorDefaultCapabilities } from "../../src/types/season";
import { assertDeclaredDatabaseTarget } from "./local-environment";

async function main(): Promise<void> {
  assertDeclaredDatabaseTarget(process.env);
  if (process.env.RIVALHUB_DB_TARGET !== "local") {
    throw new Error("开发 fixtures 只能写入明确验证过的本地数据库。");
  }

  const capabilities = createMajorDefaultCapabilities();
  await db
    .insert(seasons)
    .values({
      slug: "local-major-2027",
      name: "Local Major 2027",
      kind: "Major",
      status: "draft",
      themeColor: "#f97316",
      ...capabilities,
    })
    .onConflictDoNothing({ target: seasons.slug });
}

main()
  .then(() => {
    console.log("Local fixture ready: Local Major 2027 (local-major-2027)");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
