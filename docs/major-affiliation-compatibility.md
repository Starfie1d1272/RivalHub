# Major affiliation-rules compatibility

Migration `0008_youthful_phalanx` introduced `seasons.affiliation_rules` with
an empty default. It deliberately does not infer or backfill existing seasons:
the historical `home/external` fields cannot uniquely prove the new
institutional identity rule.

The active migration verification reconstructs the complete pre-0008 standard
Major capability contract (without reading `seasons.kind`). If any such row has
an empty affiliation rule set, verification fails closed and lists its slug.
The row must then be configured by an authorized operator before it can start;
there is no guessed data migration.

Local and `rivalhub-dev` must report that no legacy standard Major affiliation
backfill is required before this PR can be merged.
