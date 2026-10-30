import "server-only";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** Retain only fields needed to validate and present a frozen StageRun. */
export function majorRunPresentationSelection(column: SQLWrapper): SQL<unknown> {
  return sql`jsonb_build_object(
    'rootType', jsonb_typeof(${column}),
    'fields', (select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
      from jsonb_each(case when jsonb_typeof(${column}) = 'object' then ${column} else '{}'::jsonb end) as item
      where item.key in ('version', 'stagePlan', 'rosterRules', 'qualificationPolicy',
        'frozenRestrictionOverrides', 'stage', 'tournamentEntrants', 'tournamentSeeds',
        'openingPairings', 'hasThirdPlaceMatch', 'runOptions')),
    'affiliationRulesType', jsonb_typeof(${column}->'affiliationRules'),
    'frozenCompetitiveFactsType', jsonb_typeof(${column}->'frozenCompetitiveFacts'),
    'competitiveProfilePresent', coalesce(${column} ? 'competitiveProfile', false)
  )`;
}
