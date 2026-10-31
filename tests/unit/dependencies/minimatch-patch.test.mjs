import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const eslintRequire = createRequire(import.meta.resolve("eslint"));
const root = dirname(eslintRequire.resolve("minimatch/package.json"));

describe.each(["commonjs", "esm"])("minimatch 10 %s security backport", (format) => {
  it("bounds expansion and keeps matching and public APIs", () => {
    const entry = pathToFileURL(join(root, "dist", format, "index.js")).href;
    const script = `
      import assert from 'node:assert/strict';
      const m = await import(${JSON.stringify(entry)});
      const { Minimatch, minimatch, AST } = m;
      assert.equal(typeof minimatch, 'function');
      assert.equal(typeof AST, 'function');
      const capped = new Minimatch(Array(30).fill('**/../a/b').join('/'), { optimizationLevel: 2, braceExpandMax: 64 });
      assert.equal(capped.set.length, 64);
      const small = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
      assert.equal(small.set.length, 4);
      assert.equal(small.match('../a/b/../c/d'), true);
      assert.equal(small.match('x/a/b/y/c/d'), true);
      assert.ok(small.makeRe() instanceof RegExp);
      assert.ok(small.regexp instanceof RegExp);
      const deduped = new Minimatch('{x,*}/{0..9}', { optimizationLevel: 2 });
      assert.equal(deduped.set.length, 10);
      const large = new Minimatch('{x,*}/{0..999}', { optimizationLevel: 2 });
      assert.equal(large.set.length, 2000);
      assert.equal(large.match('x/5'), true);
      assert.equal(large.match('y/999'), true);
      assert.equal(large.match('.y/5'), false);
    `;
    expect(() => execFileSync(process.execPath, ["--max-old-space-size=256", "--input-type=module", "-e", script], { timeout: 15000 })).not.toThrow();
  });
});
