/** @vitest-environment node */
import { getTableColumns } from "drizzle-orm";
import { educationVerifications, institutions } from "@/db/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { panel, select } = vi.hoisted(() => ({ panel: vi.fn((props: unknown) => { void props; return null; }), select: vi.fn() }));
vi.mock("@/components/settings/EducationVerificationPanel", () => ({ EducationVerificationPanel: panel }));
vi.mock("@/lib/auth/session", () => ({ getUserSession: async () => ({ userId: "viewer" }) }));
vi.mock("@/lib/identity/linking", () => ({ listVerifiedEmailIdentities: async () => [] }));
vi.mock("@/db/client", () => ({ db: { query: { users: { findFirst: async () => ({ id: "viewer", email: "viewer@example.test", emailVerifiedAt: new Date() }) } }, select } }));
import Page from "@/app/settings/education/page";

describe("education settings client payload", () => {
  it("allows rejected claims to resume while keeping verification codes and storage keys on the server", async () => {
    const fact: Record<string, unknown> = {
      id: "claim", institutionId: "institution", institution: "学校", institutionCode: "10284",
      province: "江苏", evidenceType: "admission_notice", academicStatus: "admitted",
      status: "rejected", reviewNote: "请补充材料", submittedAt: new Date("2026-10-01T00:00:00Z"),
      evidenceCode: "private-code-marker", evidenceObjectKey: "private-object-marker",
    };
    const values = new Map<unknown, unknown>([
      ...Object.entries(getTableColumns(educationVerifications)).map(([key, column]): [unknown, unknown] => [column, fact[key]]),
      [institutions.name, fact.institution],
      [institutions.moeInstitutionCode, fact.institutionCode],
      [institutions.province, fact.province],
    ]);
    select.mockImplementation((columns: Record<string, unknown>) => {
      // Resolve actual columns, so aliasing a private column cannot hide its value.
      const row = Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, values.get(column)]));
      const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: async () => [row] };
      return chain;
    });
    renderToStaticMarkup(await Page());
    const props = panel.mock.calls[0]?.[0] as unknown as { verifications: unknown[] };
    expect(props.verifications).toContainEqual(expect.objectContaining({
      institutionId: "institution", institutionCode: "10284", evidenceType: "admission_notice", status: "rejected",
    }));
    expect(JSON.stringify(props)).not.toMatch(/private-code-marker|private-object-marker|evidenceCode|evidenceObjectKey/);
  });
});
