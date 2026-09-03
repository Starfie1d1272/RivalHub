import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function lintSource(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result?.messages ?? [];
}

describe("architecture import boundaries", () => {
  it("rejects direct brackets-manager imports outside the adapter", async () => {
    const messages = await lintSource(
      "src/lib/standings/direct-bracket-import.ts",
      'import { BracketsManager } from "brackets-manager";\nvoid BracketsManager;\n',
    );

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "no-restricted-imports",
        message: expect.stringContaining("@/lib/bracket"),
      }),
    ]));
  });

  it("allows the adapter to own the third-party import", async () => {
    const messages = await lintSource(
      "src/lib/bracket/direct-import.ts",
      'import { BracketsManager } from "brackets-manager";\nvoid BracketsManager;\n',
    );

    expect(messages.filter((message) => message.ruleId === "no-restricted-imports")).toHaveLength(0);
  });
});
