import { z } from "zod";

export const RELIABLE_EVENT_V2_SCHEMA_VERSION = "mizar.reliable-event.v2" as const;

const id = z.string().min(1).max(128);
const nullableId = id.nullable();
const utc = z.iso.datetime({ offset: true });
const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const count = nonNegativeInteger.nullable();
const steam64 = z.string().regex(/^\d{17}$/);
const steam64List = z.array(steam64).max(10);

export const reliableEventKindV2Schema = z.enum(["match_started", "map_started", "map_ended"]);

const reliableEventV2Base = z.strictObject({
  schemaVersion: z.literal(RELIABLE_EVENT_V2_SCHEMA_VERSION),
  idempotencyKey: id,
  observedAt: utc,
  matchId: z.uuid(),
  competitionId: z.uuid(),
  entryAId: z.uuid(),
  entryBId: z.uuid(),
  mapId: z.uuid().nullable(),
  mapName: z.string().max(128).nullable(),
  session: z.strictObject({
    producerInstanceId: id,
    liveSessionId: id,
    authorityRevision: z.number().int().positive(),
  }),
});

export const reliableEventV2Schema = z.discriminatedUnion("kind", [
  reliableEventV2Base.extend({
    kind: z.literal("match_started"),
    payload: z.strictObject({
      lineupSteam64: steam64List.optional(),
    }),
  }),
  reliableEventV2Base.extend({
    kind: z.literal("map_started"),
    payload: z.strictObject({
      lineupSteam64: steam64List.optional(),
    }),
  }),
  reliableEventV2Base.extend({
    kind: z.literal("map_ended"),
    payload: z.strictObject({
      scoreA: nonNegativeInteger,
      scoreB: nonNegativeInteger,
      scoreCT: nonNegativeInteger,
      scoreT: nonNegativeInteger,
      lineupSteam64: steam64List,
      players: z
        .array(
          z.strictObject({
            sourcePlayerId: id,
            canonicalPlayerId: nullableId,
            kills: count,
            assists: count,
            deaths: count,
          }),
        )
        .max(10)
        .optional(),
    }),
  }),
]);

export type ReliableEventV2 = z.infer<typeof reliableEventV2Schema>;
export type ReliableEventKindV2 = z.infer<typeof reliableEventKindV2Schema>;

export function parseReliableEventV2(input: unknown): ReliableEventV2 {
  const text = JSON.stringify(input);
  if (text === undefined || new TextEncoder().encode(text).length > 32_768) {
    throw new Error("output_payload_too_large");
  }
  return reliableEventV2Schema.parse(input);
}
