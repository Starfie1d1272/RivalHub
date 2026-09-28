import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run against a local Mizar checkout after building @mizar/protocol and
// @mizar/rivalhub. This executes Mizar's actual adapter and owned parsers.
const mizarRoot = resolve(process.argv[2] ?? "../Mizar");
const adapter = await import(pathToFileURL(resolve(mizarRoot, "packages/rivalhub/dist/index.js")).href);
const protocol = await import(pathToFileURL(resolve(mizarRoot, "packages/protocol/dist/context.js")).href);
const fixture = async (name) => JSON.parse(await readFile(resolve("tests/fixtures/contracts", name), "utf8"));

for (const [name, validate, convert, parse] of [
  ["rivalhub-provider-manifest-v1.json", adapter.validateBroadcastManifest, adapter.toMatchDocumentV1, protocol.parseMatchDocumentV1],
  ["rivalhub-provider-schedule-window-v1.json", adapter.validateBroadcastScheduleWindow, adapter.toScheduleWindowV1, protocol.parseScheduleWindowV1],
]) {
  const result = validate(await fixture(name));
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.diagnostics)}`);
  const document = parse(convert(result.value));
  if (!document || typeof document !== "object") throw new Error(`${name}: Mizar conversion returned no document`);
  process.stdout.write(`${name}: Mizar adapter and owned parser passed\n`);
}
