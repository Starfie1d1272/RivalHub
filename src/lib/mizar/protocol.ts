// Frozen producer contract, vendored from Mizar packages/protocol/src/output.ts.
// Verified against Mizar main b2820834e76a139318d2e4db6e6ed5db3a57b67a by
// scripts/mizar-contract-check.mjs; change it only together with the producer.
// RivalHub public projection lives in live-projection.ts.
import { z } from 'zod';

export const LIVE_SNAPSHOT_SCHEMA_VERSION = 'mizar.live-snapshot.v1' as const;
export const RELIABLE_EVENT_SCHEMA_VERSION = 'mizar.reliable-event.v1' as const;

const id = z.string().min(1).max(128);
const nullableId = id.nullable();
const utc = z.iso.datetime({ offset: true });
const number = z.number().finite().nullable();
const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const count = nonNegativeInteger.nullable();
const health = z.number().int().min(0).max(100).nullable();
const economy = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const cursor = z.strictObject({
  producerInstanceId: id,
  liveSessionId: nullableId,
  runtimeSeq: z.number().int().min(0),
  programSourceGeneration: z.number().int().min(0),
  programReceiveSequence: z.number().int().min(0).nullable(),
  mapEpoch: z.number().int().min(0),
});
const identity = z.enum(['unbound', 'resolving', 'matched', 'degraded', 'mismatch']);
const capability = z.strictObject({
  telemetryFresh: z.boolean(),
  contextFresh: z.boolean(),
  identity,
  lineupComplete: z.boolean(),
  radarCurrent: z.boolean(),
  canonicalTeams: z.boolean(),
});
const player = z.strictObject({
  sourcePlayerId: id,
  canonicalPlayerId: nullableId,
  identityEvidence: z.enum(['canonical', 'observed', 'unresolved']),
  lineupEvidence: z.enum(['current', 'retained']),
  displayName: z.string().max(256).nullable(),
  side: z.enum(['CT', 'T', 'unknown']),
  lifeState: z.enum(['alive', 'dead', 'unknown']),
  health: health,
  armor: health,
  hasHelmet: z.boolean().nullable(),
  hasDefuser: z.boolean().nullable(),
  money: economy,
  equipmentValue: economy,
  activeWeapon: z
    .strictObject({ name: z.string().max(128).nullable(), ammoClip: count, ammoReserve: count })
    .nullable(),
  stats: z.strictObject({
    kills: count,
    assists: count,
    deaths: count,
    liveAdr: number,
    completedAdr: number,
  }),
});
// Public overview coordinates are calibrated by Mizar; never world coordinates.
const layer = z.enum(['single', 'upper', 'lower']);
const position = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  layer,
});
export const LIVE_SNAPSHOT_MAX_BYTES = 262_144;
export const LIVE_RADAR_MAX_PLAYERS = 64;
export const LIVE_RADAR_MAX_UTILITY = 128;
export const LIVE_RADAR_MAX_FLAMES = 512;
export const publicRadarV1Schema = z
  .strictObject({
    mapName: id,
    calibrationRevision: id,
    layers: z.array(layer).min(1).max(2),
    activeLayer: layer.nullable(),
    players: z
      .array(
        z.strictObject({
          sourcePlayerId: id,
          canonicalPlayerId: nullableId,
          side: z.enum(['CT', 'T', 'unknown']),
          lifeState: z.enum(['alive', 'dead', 'unknown']),
          position: position.nullable(),
          facing: z
            .strictObject({
              x: z.number().finite().min(-1).max(1),
              y: z.number().finite().min(-1).max(1),
            })
            .nullable(),
        }),
      )
      .max(LIVE_RADAR_MAX_PLAYERS),
    bomb: z.strictObject({ position: position.nullable() }).nullable(),
    utility: z
      .array(
        z.strictObject({
          sourceEntityId: id,
          kind: z.string().max(128).nullable(),
          ownerSourceId: nullableId,
          position: position.nullable(),
          lifetimeSeconds: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
          effectTimeSeconds: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
          flames: z.array(z.strictObject({ sourceFlameId: id, position })).max(64),
        }),
      )
      .max(LIVE_RADAR_MAX_UTILITY),
  })
  .superRefine((value, ctx) => {
    if (
      value.utility.reduce((sum, utility) => sum + utility.flames.length, 0) > LIVE_RADAR_MAX_FLAMES
    )
      ctx.addIssue({ code: 'custom', message: 'radar_total_flames_exceeded' });
    const positions = [
      ...value.players.map((player) => player.position),
      value.bomb?.position,
      ...value.utility.flatMap((utility) => [
        utility.position,
        ...utility.flames.map((flame) => flame.position),
      ]),
    ];
    if (
      (value.activeLayer !== null && !value.layers.includes(value.activeLayer)) ||
      positions.some((point) => point != null && !value.layers.includes(point.layer))
    )
      ctx.addIssue({ code: 'custom', message: 'radar_layer_unavailable' });
    if (
      new Set(value.layers).size !== value.layers.length ||
      (value.layers.includes('single') ? value.layers.length !== 1 : value.layers.length !== 2)
    )
      ctx.addIssue({ code: 'custom', message: 'radar_layers_invalid' });
  });
const roundHistory = z.strictObject({
  mapOrder: z.number().int().min(1).max(5),
  completeness: z.enum(['complete', 'partial', 'unavailable']),
  rounds: z
    .array(
      z.strictObject({
        roundNumber: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        winnerSide: z.enum(['CT', 'T', 'unknown']),
        winnerEntryId: nullableId,
        winCondition: z.enum(['elimination', 'bomb', 'defuse', 'time', 'unknown']),
      }),
    )
    .max(256),
});

export const liveSnapshotV1Schema = z
  .strictObject({
    schemaVersion: z.literal(LIVE_SNAPSHOT_SCHEMA_VERSION),
    cursor,
    producedAt: utc.max(64),
    matchId: id,
    competitionId: id,
    format: z.enum(['bo1', 'bo3', 'bo5']),
    series: z.strictObject({ scoreA: count, scoreB: count, currentMapOrder: count }),
    roundHistory: roundHistory.nullable(),
    map: z.strictObject({
      mapId: nullableId,
      name: z.string().max(128).nullable(),
      phase: z.string().max(128).nullable(),
      roundNumber: count,
      scoreCT: count,
      scoreT: count,
    }),
    roundPhase: z.string().max(128).nullable(),
    clock: z
      .strictObject({ phase: z.string().max(128).nullable(), remainingSeconds: number })
      .nullable(),
    teams: z.strictObject({
      ct: z.strictObject({ entryId: nullableId, name: z.string().max(256) }),
      t: z.strictObject({ entryId: nullableId, name: z.string().max(256) }),
    }),
    players: z.array(player).max(64),
    observedPlayerSourceId: nullableId,
    bomb: z
      .strictObject({
        state: z.string().max(128).nullable(),
        carrierSourceId: nullableId,
        action: z
          .strictObject({
            kind: z.enum(['plant', 'defuse']),
            sourcePlayerId: nullableId,
            remainingSeconds: number,
            durationSeconds: number,
          })
          .nullable(),
      })
      .nullable(),
    radar: publicRadarV1Schema.nullable(),
    capability,
  })
  .superRefine((value, ctx) => {
    if (value.radar !== null) {
      if (!value.capability.radarCurrent)
        ctx.addIssue({ code: 'custom', message: 'radar_payload_not_current' });
      if (value.map.name === null || value.radar.mapName !== value.map.name)
        ctx.addIssue({ code: 'custom', message: 'radar_map_mismatch' });
    }
    if (
      value.roundHistory !== null &&
      value.series.currentMapOrder !== null &&
      value.roundHistory.mapOrder !== value.series.currentMapOrder
    )
      ctx.addIssue({ code: 'custom', message: 'round_history_map_mismatch' });
  });

export const reliableEventKindV1Schema = z.enum([
  'match_started',
  'map_started',
  'map_ended',
  'series_ended',
  'source_generation_changed',
  'map_epoch_changed',
  'identity_mismatch',
  'lineup_mismatch',
]);
const reliableEventBase = z.strictObject({
  schemaVersion: z.literal(RELIABLE_EVENT_SCHEMA_VERSION),
  idempotencyKey: id,
  cursor,
  observedAt: utc,
  matchId: id,
  competitionId: id,
  contextRevision: id,
  mapId: nullableId,
  mapName: z.string().max(128).nullable(),
  entryAId: id,
  entryBId: id,
  evidence: z.strictObject({
    identity,
    telemetryFresh: z.boolean(),
    contextFresh: z.boolean(),
    source: z.enum(['runtime-transition', 'runtime-continuity', 'series-progress', 'identity']),
  }),
});
const emptyPayload = z.strictObject({});
const reason = z.string().max(128).nullable();
export const reliableEventV1Schema = z.discriminatedUnion('kind', [
  reliableEventBase.extend({ kind: z.literal('match_started'), payload: emptyPayload }),
  reliableEventBase.extend({ kind: z.literal('map_started'), payload: emptyPayload }),
  reliableEventBase.extend({
    kind: z.literal('map_ended'),
    payload: z.strictObject({
      scoreA: nonNegativeInteger,
      scoreB: nonNegativeInteger,
      scoreCT: nonNegativeInteger,
      scoreT: nonNegativeInteger,
    }),
  }),
  reliableEventBase.extend({
    kind: z.literal('series_ended'),
    payload: z.strictObject({ scoreA: count, scoreB: count }),
  }),
  reliableEventBase.extend({
    kind: z.literal('source_generation_changed'),
    payload: z.strictObject({ previousSourceGeneration: count }),
  }),
  reliableEventBase.extend({
    kind: z.literal('map_epoch_changed'),
    payload: z.strictObject({ previousMapEpoch: count, reason }),
  }),
  reliableEventBase.extend({
    kind: z.literal('identity_mismatch'),
    payload: z.strictObject({ reason }),
  }),
  reliableEventBase.extend({
    kind: z.literal('lineup_mismatch'),
    payload: z.strictObject({ reason }),
  }),
]);

export type LiveSnapshotV1 = z.infer<typeof liveSnapshotV1Schema>;
export type ReliableEventV1 = z.infer<typeof reliableEventV1Schema>;
export type ReliableEventKindV1 = z.infer<typeof reliableEventKindV1Schema>;

function boundedParse<T>(schema: z.ZodType<T>, input: unknown, maxBytes: number): T {
  const text = JSON.stringify(input);
  if (text === undefined || new TextEncoder().encode(text).length > maxBytes)
    throw new Error('output_payload_too_large');
  return schema.parse(input);
}
export const parseLiveSnapshotV1 = (input: unknown): LiveSnapshotV1 =>
  boundedParse(liveSnapshotV1Schema, input, LIVE_SNAPSHOT_MAX_BYTES);
export const parseReliableEventV1 = (input: unknown): ReliableEventV1 =>
  boundedParse(reliableEventV1Schema, input, 16_384);
