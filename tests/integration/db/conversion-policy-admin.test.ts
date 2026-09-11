import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs, conversionPolicies } from "@/db/schema";
import {
  approveConversionPolicyInTx,
  createConversionPolicyDraftInTx,
  loadConversionPolicyAdminRows,
  loadConversionPolicyProvenance,
  retireConversionPolicyInTx,
  setCurrentConversionPolicyInTx,
  updateConversionPolicyDraftInTx,
  extractConversionPolicyReference,
} from "@/lib/competitive/conversion-policy-admin";
import { migrationFiles, replayMigration, withScratchDatabase } from "./harness/migration-replay";

const TARGET_MIGRATION = "0041_perpetual_grey_gargoyle.sql";

function eventPolicySnapshot(config: unknown) {
  const reference = extractConversionPolicyReference(config);
  const profile = (config as { competitiveProfile?: { fallbackConversion?: { mapping?: unknown } } } | null)?.competitiveProfile;
  return {
    policyId: reference.conversionPolicyId,
    policyVersion: reference.conversionPolicyVersion,
    frozenVersion: reference.fallbackConversionVersion,
    frozenMapping: profile?.fallbackConversion?.mapping ?? null,
  };
}

describe("conversion policy admin lifecycle", () => {
  it("enforces the lifecycle in real PostgreSQL and preserves event references across current switches", async () => {
    await withScratchDatabase("rivalhub_conversion_policy_admin", async (client: Client) => {
      for (const migration of migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name)).filter((name) => name <= TARGET_MIGRATION)) {
        await replayMigration(client, migration);
      }
      const executor = drizzle(client, { schema });
      const actorId = randomUUID();
      await client.query(
        `INSERT INTO users (id, email, role) VALUES ($1, $2, 'super_admin')`,
        [actorId, `${actorId}@example.test`],
      );

      const [base] = await executor.select().from(conversionPolicies).where(eq(conversionPolicies.isCurrent, true));
      expect(base).toBeDefined();
      if (!base) throw new Error("migration must seed a current policy");

      const foreignPolicyId = randomUUID();
      await client.query(
        `INSERT INTO conversion_policies (id, source_platform, target_platform, version, status, mapping, approved_at, approved_by)
         VALUES ($1, 'other_source', 'other_target', '1.0', 'approved', $2::jsonb, now(), $3)`,
        [foreignPolicyId, JSON.stringify(base.mapping), actorId],
      );

      await expect(executor.transaction((tx) => createConversionPolicyDraftInTx(tx, {
        basePolicyId: base.id,
        version: base.version,
      }, actorId))).rejects.toThrow(`策略版本 ${base.version} 已存在`);

      const draft = await executor.transaction((tx) => createConversionPolicyDraftInTx(tx, {
        basePolicyId: base.id,
        version: "2026.10",
        sourceNote: "新的赛事委员会来源说明。",
        rationale: "新的赛事比较理由。",
        changeSummary: "扩展当前版本。",
        internalNote: "仅管理员可见。",
      }, actorId));
      const draftRow = await executor.select().from(conversionPolicies).where(eq(conversionPolicies.id, draft.id));
      expect(draftRow[0]?.status).toBe("draft");
      expect(draftRow[0]?.mapping).toEqual(base.mapping);

      await client.query(
        `UPDATE conversion_policies SET mapping = $1::jsonb WHERE id = $2`,
        [JSON.stringify({ relativeSeasonAlignment: true, belowSRankMap: base.mapping.belowSRankMap, starSegments: [] }), draft.id],
      );
      await expect(executor.transaction((tx) => approveConversionPolicyInTx(tx, draft.id, actorId))).rejects.toThrow("S 段星数映射不能为空");
      const invalidDraft = await executor.select({ status: conversionPolicies.status }).from(conversionPolicies).where(eq(conversionPolicies.id, draft.id));
      expect(invalidDraft[0]?.status).toBe("draft");

      await expect(executor.transaction((tx) => updateConversionPolicyDraftInTx(tx, {
        id: draft.id,
        mapping: { ...base.mapping, starSegments: [{ ...base.mapping.starSegments[0]!, maxStar: 4 }, ...base.mapping.starSegments.slice(1)] },
      }, actorId))).rejects.toThrow("空缺或重叠");

      await executor.transaction((tx) => updateConversionPolicyDraftInTx(tx, {
        id: draft.id,
        mapping: base.mapping,
        sourceNote: "新的赛事委员会来源说明。",
        rationale: "新的赛事比较理由。",
        changeSummary: "扩展当前版本。",
        internalNote: "仅管理员可见。",
      }, actorId));
      await executor.transaction((tx) => approveConversionPolicyInTx(tx, draft.id, actorId));
      await expect(executor.transaction((tx) => updateConversionPolicyDraftInTx(tx, { id: draft.id, mapping: base.mapping }, actorId))).rejects.toThrow("只有草稿策略可以编辑");

      const frozenConfig = JSON.stringify({
        requireCompetitiveProfile: true,
        competitiveProfile: {
          platform: "perfect_world",
          currentSeasonKey: "perfect-current",
          previousSeasonKey: "perfect-previous",
          rankOrder: [],
          conversionPolicyId: base.id,
          conversionPolicyVersion: base.version,
          fallbackConversion: { sourcePlatform: "fivee", version: base.version, seasonKeyMap: {}, mapping: base.mapping },
        },
      });
      const eventIds: string[] = [];
      for (const [suffix, openedAt] of [["published", null], ["open", "2026-09-07T00:00:00Z"]] as const) {
        const seasonId = randomUUID();
        eventIds.push(seasonId);
        await client.query(
          `INSERT INTO seasons (id, slug, name, kind, status, team_registration_config, registration_opened_at)
           VALUES ($1, $2, $3, 'Major', 'registration', $4::json, $5::timestamptz)`,
          [seasonId, `conversion-policy-${suffix}-${randomUUID()}`, `Conversion Policy ${suffix}`, frozenConfig, openedAt],
        );
      }

      const readEventPolicySnapshots = async () => (await executor.select({ id: schema.seasons.id, config: schema.seasons.teamRegistrationConfig })
        .from(schema.seasons)
        .where(inArray(schema.seasons.id, eventIds)))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((row) => eventPolicySnapshot(row.config));
      const eventSnapshotsBeforeSwitch = await readEventPolicySnapshots();
      expect(eventSnapshotsBeforeSwitch).toHaveLength(2);
      expect(eventSnapshotsBeforeSwitch).toEqual(eventIds.map(() => ({
        policyId: base.id,
        policyVersion: base.version,
        frozenVersion: base.version,
        frozenMapping: base.mapping,
      })));

      await expect(executor.transaction((tx) => retireConversionPolicyInTx(tx, base.id, actorId))).rejects.toThrow("当前策略不能直接退役");
      await executor.transaction((tx) => setCurrentConversionPolicyInTx(tx, draft.id, actorId));
      const eventSnapshotsAfterSwitch = await readEventPolicySnapshots();
      expect(eventSnapshotsAfterSwitch).toEqual(eventSnapshotsBeforeSwitch);
      await executor.transaction((tx) => setCurrentConversionPolicyInTx(tx, draft.id, actorId));
      await executor.transaction((tx) => retireConversionPolicyInTx(tx, base.id, actorId));

      const currentPolicies = await executor.select({ id: conversionPolicies.id, status: conversionPolicies.status, isCurrent: conversionPolicies.isCurrent }).from(conversionPolicies);
      expect(currentPolicies.find((row) => row.id === draft.id)).toMatchObject({ status: "approved", isCurrent: true });
      expect(currentPolicies.find((row) => row.id === base.id)).toMatchObject({ status: "retired", isCurrent: false });

      const rows = await loadConversionPolicyAdminRows(executor);
      expect(rows.some((row) => row.id === foreignPolicyId)).toBe(false);
      const baseAdminRow = rows.find((row) => row.id === base.id);
      expect(baseAdminRow?.eventReferences).toHaveLength(2);
      expect(baseAdminRow?.eventReferences.map((reference) => reference.referenceState).sort()).toEqual(["published_locked", "registration_frozen"]);
      expect(baseAdminRow?.eventReferences.every((reference) => reference.policyId === base.id)).toBe(true);

      const provenance = await loadConversionPolicyProvenance(executor, JSON.parse(frozenConfig));
      expect(provenance).toMatchObject({ id: base.id, version: base.version, sourceNote: base.sourceNote, rationale: base.rationale, changeSummary: base.changeSummary });
      expect(provenance).not.toHaveProperty("internalNote");

      const auditRows = await executor.select({ action: auditLogs.action, targetType: auditLogs.targetType, targetId: auditLogs.targetId }).from(auditLogs).where(eq(auditLogs.targetType, "conversion_policy"));
      expect(auditRows.map((row) => row.action)).toEqual(expect.arrayContaining([
        "conversion_policy.create_draft",
        "conversion_policy.update_draft",
        "conversion_policy.approve",
        "conversion_policy.set_current",
        "conversion_policy.retire",
      ]));
      expect(auditRows.filter((row) => row.action === "conversion_policy.set_current")).toHaveLength(1);
    });
  });
});
