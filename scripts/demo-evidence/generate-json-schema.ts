import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { rivalHubDemoEvidenceV1Schema } from "../../src/lib/demo-evidence/contract";

const output = resolve(process.cwd(), "docs/contracts/rivalhub-demo-evidence-v1.schema.json");

async function main() {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(z.toJSONSchema(rivalHubDemoEvidenceV1Schema, { target: "draft-2020-12" }), null, 2)}\n`);
}

void main();
