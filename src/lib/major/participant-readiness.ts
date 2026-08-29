/**
 * Compatibility re-exports. The qualification orchestration owner lives in
 * `@/lib/qualification/service`; batched loaders supersede the per-user N+1
 * access pattern that used to live here.
 */
export {
  resolveCompetitiveContext,
  getParticipantReadiness,
  getParticipantReadinessBatch,
  type ParticipantReadiness,
} from "@/lib/qualification/service";
