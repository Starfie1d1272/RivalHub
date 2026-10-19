import { z } from "zod";
import { DemoEvidenceValidationError } from "./validation-error";
import { sanitizeDiagnosticCode, sanitizeDiagnosticMessage, sanitizeDiagnosticPath } from "./diagnostic-safety";

export const DAK_DIAGNOSTICS_EXTENSION = "cs2dak/diagnostics";
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Deterministic source diagnostics only. Runtime logs and attempt metadata are forbidden. */
export const dakDiagnosticsSchema = z.object({
  version: z.literal(1),
  qa: z.object({
    issues: z.array(z.object({
      code: z.string().min(1).max(96).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/)
        .refine((value) => sanitizeDiagnosticCode(value) === value, "诊断 code 必须脱敏"),
      severity: z.enum(["error", "warning"]),
      path: z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*|\[\d+\])*$/).nullable()
        .refine((value) => sanitizeDiagnosticPath(value) === value, "诊断 path 必须是脱敏逻辑定位"),
      message: z.string().min(1).max(320)
        .refine((value) => sanitizeDiagnosticMessage(value) === value, "诊断 message 必须脱敏"),
    }).strict()).max(64),
    omittedIssueCount: count,
  }).strict(),
  richKills: z.object({
    eventCount: count,
    flagsEventCount: count,
    namedActiveWeaponEventCount: count,
    reason: z.enum(["no_kill_events", "flags_and_named_active_weapon", "no_named_active_weapon", "no_rich_kill_flags"]),
  }).strict(),
}).strict();

export type DakDiagnostics = z.infer<typeof dakDiagnosticsSchema>;

/** Validate relationships, never reconstruct QA issues or analytical capability decisions. */
export function validateDakDiagnostics(
  diagnostics: DakDiagnostics,
  quality: { qa: { ok: boolean; issueCount: number; errorCount: number; warningCount: number };
    capabilities: { richKills: "available" | "partial" | "missing" } },
  killCount: number,
): void {
  const { qa, richKills } = diagnostics;
  const errors = qa.issues.filter((issue) => issue.severity === "error").length;
  const warnings = qa.issues.length - errors;
  if (qa.issues.length + qa.omittedIssueCount !== quality.qa.issueCount
    || quality.qa.errorCount + quality.qa.warningCount !== quality.qa.issueCount
    || quality.qa.ok !== (quality.qa.errorCount === 0)
    || errors > quality.qa.errorCount || warnings > quality.qa.warningCount) {
    throw new DemoEvidenceValidationError("QA diagnostics 与质量摘要不一致");
  }
  if (richKills.eventCount !== killCount || richKills.flagsEventCount > killCount
    || richKills.namedActiveWeaponEventCount > killCount) {
    throw new DemoEvidenceValidationError("richKills diagnostics 计数不一致");
  }
  const reasonHasEvidence = {
    no_kill_events: killCount === 0,
    flags_and_named_active_weapon: richKills.flagsEventCount > 0 && richKills.namedActiveWeaponEventCount > 0,
    no_named_active_weapon: richKills.flagsEventCount > 0 && richKills.namedActiveWeaponEventCount === 0,
    no_rich_kill_flags: killCount > 0 && richKills.flagsEventCount === 0,
  };
  const availability = {
    no_kill_events: "available",
    flags_and_named_active_weapon: "available",
    no_named_active_weapon: "partial",
    no_rich_kill_flags: "missing",
  } as const;
  if (!reasonHasEvidence[richKills.reason] || availability[richKills.reason] !== quality.capabilities.richKills) {
    throw new DemoEvidenceValidationError("richKills diagnostics 与能力摘要不一致");
  }
}
