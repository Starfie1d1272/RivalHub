import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { rivalHubDemoEvidenceV1Schema } from "../../src/lib/demo-evidence/contract";

export const rivalHubDemoEvidenceV1SchemaPath = resolve(process.cwd(), "docs/contracts/rivalhub-demo-evidence-v1.schema.json");

export function serializeRivalHubDemoEvidenceV1JsonSchema(): string {
  return `${JSON.stringify(z.toJSONSchema(rivalHubDemoEvidenceV1Schema, { target: "draft-2020-12" }), null, 2)}\n`;
}

async function main(checkOnly: boolean) {
  const generated = serializeRivalHubDemoEvidenceV1JsonSchema();
  if (checkOnly) {
    const checkedIn = await readFile(rivalHubDemoEvidenceV1SchemaPath, "utf8");
    if (checkedIn !== generated) throw new Error("checked-in RivalHubDemoEvidenceV1 JSON Schema 与 Zod contract 不一致；请运行 pnpm demo-evidence:schema");
    return;
  }
  await mkdir(dirname(rivalHubDemoEvidenceV1SchemaPath), { recursive: true });
  await writeFile(rivalHubDemoEvidenceV1SchemaPath, generated);
}

if (import.meta.url === `file://${process.argv[1]}`) void main(process.argv.includes("--check"));
