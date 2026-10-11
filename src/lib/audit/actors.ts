import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { dakPairings, mizarInstallations, steamProfiles, users } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getAuditActorLabel, isAuditUserEmail, isAuditUserId, readMizarAuditInstallationId } from "./people";
import type { AuditDatabaseExecutor } from "./targets";

export interface AuditActorRef {
  actorId: string | null;
  action: string;
  seasonId: string | null;
}

export interface AuditActorPresentation {
  label: string;
  kind: "user" | "system" | "machine" | "unknown";
  /** Current authorization relationship; never identifies the device operator. */
  authorizedByLabel?: string;
}

const MIZAR_MACHINE_ACTIONS = new Set([
  "mizar.source.claim", "mizar.source.release", "mizar.reliable.accept", "mizar.map.revalidated",
  "match.start.reality_warning",
]);
const MIZAR_SHARED_ACTIONS = new Set(["match.start", "match.map.start", "match.record_map_result", "mizar.installation.revoke"]);

export function auditActorKey(ref: AuditActorRef): string {
  return JSON.stringify([ref.actorId, ref.action, ref.seasonId]);
}

/** Server read model: batch canonical relationships, selecting no credential columns. */
export async function resolveAuditActors(
  refs: readonly AuditActorRef[],
  names: ReadonlyMap<string, string>,
  executor: AuditDatabaseExecutor = db,
): Promise<Map<string, AuditActorPresentation>> {
  const installationIds = [...new Set(refs.flatMap(ref => {
    const typedId = readMizarAuditInstallationId(ref.actorId);
    const legacyId = isAuditUserId(ref.actorId) && (MIZAR_MACHINE_ACTIONS.has(ref.action) || MIZAR_SHARED_ACTIONS.has(ref.action)) ? ref.actorId : null;
    return typedId ? [typedId] : legacyId ? [legacyId] : [];
  }))];
  const pairingIds = [...new Set(refs.flatMap(ref => {
    const id = ref.actorId?.startsWith("dak:") ? ref.actorId.slice(4) : null;
    return isAuditUserId(id) ? [id] : [];
  }))];
  const publicNameColumns = {
    displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName,
  };
  const installations = installationIds.length ? await executor.select({
    id: mizarInstallations.id, competitionId: mizarInstallations.competitionId, ...publicNameColumns,
  }).from(mizarInstallations)
    .leftJoin(users, eq(users.id, mizarInstallations.authorizedByUserId))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(inArray(mizarInstallations.id, installationIds)) : [];
  const pairings = pairingIds.length ? await executor.select({
    id: dakPairings.id, seasonIds: dakPairings.seasonIds, ...publicNameColumns,
  }).from(dakPairings)
    .leftJoin(users, eq(users.id, dakPairings.userId))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(inArray(dakPairings.id, pairingIds)) : [];
  const installationById = new Map(installations.map(row => [row.id, row]));
  const pairingById = new Map(pairings.map(row => [row.id, row]));
  return new Map(refs.map(ref => {
    const id = ref.actorId;
    let actor: AuditActorPresentation = {
      label: getAuditActorLabel(id, names),
      kind: !id || id === "system" || id === "veto-system" || id.startsWith("system:") ? "system"
        : readMizarAuditInstallationId(id) || id.startsWith("dak:") || id.startsWith("release:") ? "machine"
          : isAuditUserId(id) || isAuditUserEmail(id) ? "user" : "unknown",
    };
    const typedInstallationId = readMizarAuditInstallationId(id);
    const installation = id ? installationById.get(typedInstallationId ?? id) : undefined;
    if (installation && ref.seasonId === installation.competitionId
      && (typedInstallationId || MIZAR_MACHINE_ACTIONS.has(ref.action) || MIZAR_SHARED_ACTIONS.has(ref.action))) {
      actor = { label: "Mizar", kind: "machine", authorizedByLabel: getPublicDisplayName(installation) };
    } else if (isAuditUserId(id) && MIZAR_MACHINE_ACTIONS.has(ref.action)) {
      actor = { label: "Mizar", kind: "machine" };
    }
    const pairing = id?.startsWith("dak:") ? pairingById.get(id.slice(4)) : undefined;
    if (pairing && (ref.seasonId === null || pairing.seasonIds.includes("*") || pairing.seasonIds.includes(ref.seasonId))) {
      actor.authorizedByLabel = getPublicDisplayName(pairing);
    }
    return [auditActorKey(ref), actor];
  }));
}
