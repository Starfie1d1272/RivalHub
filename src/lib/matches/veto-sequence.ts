import type { MatchFormat, Side, VetoActionType } from "@/types/match";
import { AppError, ErrorCode } from "@/lib/errors";

export type VetoActorRole = "veto_a" | "veto_b" | "system";

export interface VetoStepFact {
  turnKey: string;
  actionType: VetoActionType;
  mapName: string;
  entryId: string | null;
  side: Side | null;
}

export interface VetoTurnDefinition {
  key: string;
  actionType: VetoActionType;
  actor: VetoActorRole;
  count: number;
  durationSeconds: number | null;
  mapFromTurnKey?: string;
}

export type CurrentVetoTurn = Omit<VetoTurnDefinition, "actionType"> & {
  actionType: VetoActionType | "role_select";
  actorEntryId: string | null;
  completed: number;
  mapName: string | null;
};

export function deriveHigherSeedEntry(input: {
  entryAId: string;
  entryBId: string;
  entrants: readonly { entryId: string; seed: number }[];
}): string | null {
  if (input.entrants.length !== 2) return null;
  const [first, second] = input.entrants;
  if (!first || !second || first.entryId === second.entryId) return null;
  if (first.seed < 1 || second.seed < 1 || first.seed === second.seed) return null;
  const entries = new Set([input.entryAId, input.entryBId]);
  if (!entries.has(first.entryId) || !entries.has(second.entryId)) return null;
  return first.seed < second.seed ? first.entryId : second.entryId;
}

const turn = (
  key: string,
  actionType: VetoActionType,
  actor: VetoActorRole,
  durationSeconds: number | null,
  count = 1,
  mapFromTurnKey?: string,
): VetoTurnDefinition => ({ key, actionType, actor, count, durationSeconds, mapFromTurnKey });

export function getVetoTurnDefinitions(format: MatchFormat): readonly VetoTurnDefinition[] {
  const turns: Record<MatchFormat, readonly VetoTurnDefinition[]> = {
    bo1: [
      turn("ban-veto-a-opening", "ban", "veto_a", 60, 2),
      turn("ban-veto-b-opening", "ban", "veto_b", 75, 3),
      turn("ban-veto-a-final", "ban", "veto_a", 45),
      turn("system-decider", "decider", "system", null),
      turn("side-pick-decider", "side_pick", "veto_b", 45, 1, "system-decider"),
    ],
    bo3: [
      turn("ban-veto-a-opening", "ban", "veto_a", 45),
      turn("ban-veto-b-opening", "ban", "veto_b", 45),
      turn("pick-veto-a-map-1", "pick", "veto_a", 45),
      turn("side-pick-map-1", "side_pick", "veto_b", 45, 1, "pick-veto-a-map-1"),
      turn("pick-veto-b-map-2", "pick", "veto_b", 45),
      turn("side-pick-map-2", "side_pick", "veto_a", 45, 1, "pick-veto-b-map-2"),
      turn("ban-veto-b-final", "ban", "veto_b", 45),
      turn("ban-veto-a-final", "ban", "veto_a", 45),
      turn("system-decider", "decider", "system", null),
      turn("side-pick-decider", "side_pick", "veto_b", 45, 1, "system-decider"),
    ],
    bo5: [
      turn("ban-veto-a-opening", "ban", "veto_a", 45),
      turn("ban-veto-b-opening", "ban", "veto_b", 45),
      turn("pick-veto-a-map-1", "pick", "veto_a", 45),
      turn("side-pick-map-1", "side_pick", "veto_b", 45, 1, "pick-veto-a-map-1"),
      turn("pick-veto-b-map-2", "pick", "veto_b", 45),
      turn("side-pick-map-2", "side_pick", "veto_a", 45, 1, "pick-veto-b-map-2"),
      turn("pick-veto-a-map-3", "pick", "veto_a", 45),
      turn("side-pick-map-3", "side_pick", "veto_b", 45, 1, "pick-veto-a-map-3"),
      turn("pick-veto-b-map-4", "pick", "veto_b", 45),
      turn("side-pick-map-4", "side_pick", "veto_a", 45, 1, "pick-veto-b-map-4"),
      turn("system-decider", "decider", "system", null),
    ],
  };
  return turns[format];
}

export function deriveCurrentVetoTurn(input: {
  format: MatchFormat;
  entryAId: string;
  entryBId: string;
  privilegedEntryId: string | null;
  vetoTeamAEntryId: string | null;
  mapPool: readonly string[];
  steps: readonly VetoStepFact[];
}): CurrentVetoTurn | null {
  if (input.privilegedEntryId === null) return null;
  if (input.vetoTeamAEntryId === null) {
    return {
      key: "choose-veto-team-a",
      actionType: "role_select",
      actor: "system",
      count: 1,
      durationSeconds: 45,
      actorEntryId: input.privilegedEntryId,
      completed: 0,
      mapName: null,
    };
  }

  const definitions = getVetoTurnDefinitions(input.format);
  for (const definition of definitions) {
    const completed = input.steps.filter((step) => step.turnKey === definition.key).length;
    if (completed >= definition.count) continue;

    let mapName: string | null = null;
    if (definition.actionType === "decider") {
      const used = new Set(input.steps.filter((step) => step.actionType !== "side_pick").map((step) => step.mapName));
      mapName = input.steps.find((step) => step.turnKey === definition.key)?.mapName ?? null;
      if (mapName === null) {
        const remaining = input.mapPool.filter((name) => !used.has(name));
        // The sequence only reaches this turn after six maps have been removed or picked.
        if (remaining.length === 1) mapName = remaining[0] ?? null;
      }
    } else if (definition.mapFromTurnKey) {
      mapName = input.steps.find((step) => step.turnKey === definition.mapFromTurnKey)?.mapName ?? null;
    }

    return {
      ...definition,
      actorEntryId: resolveActorEntry(definition.actor, input),
      completed,
      mapName,
    };
  }
  return null;
}

export function resolveActorEntry(
  actor: VetoActorRole,
  input: { entryAId: string; entryBId: string; privilegedEntryId: string | null; vetoTeamAEntryId: string | null },
): string | null {
  if (actor === "system") return null;
  if (actor === "veto_a") return input.vetoTeamAEntryId;
  if (input.vetoTeamAEntryId === null) return null;
  return input.vetoTeamAEntryId === input.entryAId ? input.entryBId : input.entryAId;
}

export function getEligibleVetoMaps(pool: readonly string[], steps: readonly VetoStepFact[]): string[] {
  const used = new Set(steps.filter((step) => step.actionType !== "side_pick").map((step) => step.mapName));
  return pool.filter((mapName) => !used.has(mapName));
}

export function sortVetoOptions(options: readonly string[]): string[] {
  return [...new Set(options)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function chooseVetoOptions(
  options: readonly string[],
  count: number,
  randomIndex: (maxExclusive: number) => number,
): string[] {
  const remaining = sortVetoOptions(options);
  const selected: string[] = [];
  while (selected.length < count && remaining.length > 0) {
    const index = randomIndex(remaining.length);
    const [choice] = remaining.splice(index, 1);
    if (choice !== undefined) selected.push(choice);
  }
  return selected;
}

export function projectVetoMapPlan(input: {
  steps: readonly VetoStepFact[];
  entryAId: string;
  format: MatchFormat;
}): Array<{ mapOrder: number; mapName: string; pickedByEntryId: string | null; teamAStartSide: Side | null }> {
  const picks = input.steps.filter((step) => step.actionType === "pick");
  const decider = input.steps.find((step) => step.actionType === "decider");
  const mapSteps = [...picks, ...(decider ? [decider] : [])];

  return mapSteps.map((mapStep, index) => {
    const sidePick = input.steps.find((step) => step.actionType === "side_pick" && step.mapName === mapStep.mapName);
    const knifeMap = input.format === "bo5" && index === 4;
    const teamAStartSide = sidePick && !knifeMap
      ? (sidePick.entryId === input.entryAId || sidePick.side === null
        ? sidePick.side
        : sidePick.side === "t" ? "ct" : "t")
      : null;
    return {
      mapOrder: index + 1,
      mapName: mapStep.mapName,
      pickedByEntryId: mapStep.actionType === "pick" ? mapStep.entryId : null,
      teamAStartSide,
    };
  });
}

export function isVetoTurnKey(format: MatchFormat, turnKey: string): boolean {
  return turnKey === "choose-veto-team-a" || getVetoTurnDefinitions(format).some((turn) => turn.key === turnKey);
}

export interface VetoSequenceStep {
  actionType: VetoActionType;
  entryId: string | null;
  mapName?: string;
  side?: Side | null;
}

export interface LegacyVetoSequenceStep extends VetoSequenceStep {
  mapName: string;
  side?: Side | null;
}

function otherEntry(entryId: string, entryAId: string, entryBId: string): string {
  return entryId === entryAId ? entryBId : entryAId;
}

function expectedLegacySequence(
  format: MatchFormat,
  vetoAEntryId: string,
  entryAId: string,
  entryBId: string,
): VetoSequenceStep[] {
  const vetoBEntryId = otherEntry(vetoAEntryId, entryAId, entryBId);
  const actorEntry = (actor: VetoActorRole) => actor === "veto_a"
    ? vetoAEntryId
    : actor === "veto_b" ? vetoBEntryId : null;
  const expected: VetoSequenceStep[] = [];
  for (const definition of getVetoTurnDefinitions(format)) {
    if (definition.actionType === "ban" || definition.actionType === "pick") {
      for (let index = 0; index < definition.count; index += 1) {
        expected.push({ actionType: definition.actionType, entryId: actorEntry(definition.actor) });
      }
    } else if (definition.actionType === "decider") {
      // The post-match dialog stores the decider-side actor on the legacy row.
      expected.push({ actionType: "decider", entryId: format === "bo5" ? null : vetoBEntryId });
    }
  }
  return expected;
}

/** Validate the historical flat input against the current canonical sequence.
 * The first recorded actor defines VETO A, so entryA/entryB display order is not authority.
 */
export function assertVetoSequence(
  format: MatchFormat,
  steps: readonly VetoSequenceStep[],
  entryAId: string,
  entryBId: string,
): void {
  const firstEntryId = steps[0]?.entryId;
  if (!firstEntryId || (firstEntryId !== entryAId && firstEntryId !== entryBId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 首步必须由本场参赛队执行");
  }
  const expected = expectedLegacySequence(format, firstEntryId, entryAId, entryBId);
  if (steps.length !== expected.length || steps.some((step, index) => step.actionType !== expected[index]?.actionType)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, format.toUpperCase() + " BP 步骤顺序不合法");
  }
  if (steps.some((step, index) => step.entryId !== expected[index]?.entryId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, format.toUpperCase() + " BP 操作顺序不合法");
  }
  if (steps.some((step, index) => (
    step.side !== null &&
    step.side !== undefined &&
    (expected[index]?.actionType === "ban" || (format === "bo5" && expected[index]?.actionType === "decider"))
  ))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "该 BP 步骤不应包含选边事实");
  }
}

/** Convert the legacy post-match dialog rows into canonical turn facts. */
export function legacyVetoStepsToFacts(
  format: MatchFormat,
  steps: readonly LegacyVetoSequenceStep[],
  entryAId: string,
  entryBId: string,
): VetoStepFact[] {
  assertVetoSequence(format, steps, entryAId, entryBId);
  const vetoAEntryId = steps[0]!.entryId!;
  const vetoBEntryId = otherEntry(vetoAEntryId, entryAId, entryBId);
  const actorEntry = (actor: VetoActorRole) => actor === "veto_a"
    ? vetoAEntryId
    : actor === "veto_b" ? vetoBEntryId : null;
  const facts: VetoStepFact[] = [];
  const mapByTurnKey = new Map<string, string>();
  let legacyIndex = 0;

  for (const definition of getVetoTurnDefinitions(format)) {
    if (definition.actionType === "ban" || definition.actionType === "pick") {
      for (let index = 0; index < definition.count; index += 1) {
        const step = steps[legacyIndex++]!;
        facts.push({
          turnKey: definition.key,
          actionType: definition.actionType,
          mapName: step.mapName,
          entryId: step.entryId,
          side: null,
        });
        if (definition.actionType === "pick") mapByTurnKey.set(definition.key, step.mapName);
      }
      continue;
    }
    if (definition.actionType === "decider") {
      const step = steps[legacyIndex++]!;
      mapByTurnKey.set(definition.key, step.mapName);
      facts.push({ turnKey: definition.key, actionType: "decider", mapName: step.mapName, entryId: null, side: null });
      continue;
    }

    const mapName = mapByTurnKey.get(definition.mapFromTurnKey ?? "");
    if (!mapName) continue;
    const sideStep = definition.mapFromTurnKey === "system-decider"
      ? steps[steps.length - 1]
      : steps.find((step) => step.actionType === "pick" && step.mapName === mapName);
    if (!sideStep?.side) continue;
    const sidePickerEntryId = definition.mapFromTurnKey === "system-decider"
      ? sideStep.entryId
      : sideStep.entryId ? otherEntry(sideStep.entryId, entryAId, entryBId) : null;
    facts.push({
      turnKey: definition.key,
      actionType: "side_pick",
      mapName,
      entryId: sidePickerEntryId ?? actorEntry(definition.actor),
      side: sideStep.side,
    });
  }
  return facts;
}
