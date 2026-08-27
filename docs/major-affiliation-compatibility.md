# Major affiliation-rules compatibility

Migration `0008_youthful_phalanx` introduced `seasons.affiliation_rules` with
an empty default. It deliberately does not infer or backfill existing seasons:
the historical `home/external` fields cannot uniquely prove the new
institutional identity rule.

The active migration verification reconstructs the complete pre-0008 standard
Major capability contract (without reading `seasons.kind`). If any such row has
an empty affiliation rule set, deployment verification fails closed and lists
its slug. It cannot be guessed from `kind`, nor can ordinary non-draft season
editing alter this locked core rule. An authorized deployment must explicitly
choose and prove a migration or repair strategy before proceeding.

Local and `rivalhub-dev` currently must report that no legacy standard Major
affiliation backfill is required before this PR can be merged.
