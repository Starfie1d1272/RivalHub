# Dependency patches

## `@cs2dak/tournament@1.1.1`

The tournament package owns transparent performance accumulation and finalization.
RivalHub persists its versioned per-map accumulators so public reads no longer need
Evidence player-round JSON. This patch extends the package at that boundary; it
does not implement a second metric engine in RivalHub.

The patch extracts the existing collector/finalizer without changing their formulas
and adds public collect, JSON persistence, merge/finalize, team scope, and identity
remapping APIs. Accumulators retain raw counts, denominators, map/match identities,
local round sequence sets, side slices, all weapon/player buckets, and objective
attribution. The wire format omits redundant per-map metadata and map/team/global
weapon copies and uses versioned quantity arrays to avoid repeated field names. No final percentages are averaged. Raw input still goes through the
existing complete-map validator before a projection can be created. Team filtering
happens after that validation so an opening duel does not become an invalid
one-sided input.

`TOURNAMENT_PERFORMANCE_PROJECTION_VERSION` is the serialization contract version.
Consumers must treat `data` as opaque and rebuild from retained Evidence if the
contract or calculation version changes. Labels remain read-time inputs. Merging
per-map floating sums may differ from sequential per-round summation at machine
precision; integral counts and null denominators remain exact. The regression
suite compares every output field, permits only < 1e-9 error for non-integral
numbers, and covers persisted JSON, side slices, transfer isolation, objective
attribution, weapons, empty samples, map/match deduplication, and invalid inputs.

For the checked-in normal/OT fixtures (compact JSON with test identity bindings),
Evidence is 158,138 / 242,363 bytes; combined tournament/performance projections are
33,382 / 37,597 bytes. This is a fixture measurement, not a production billing
measurement. The regression suite requires performance projection bytes below
25% of the corresponding multi-map player-round facts.

This exact-version pnpm patch is an explicit bridge for the single RivalHub change.
It includes readable package JavaScript and declarations; no registry release or
upstream repository mutation is required. Exit condition: publish the equivalent
DAK public projection contract through DAK's normal review/release process, upgrade
the pinned dependency, verify the persistence contract and parity tests, then
remove this patch. A changed serialization/calculation version requires a controlled
projection rebuild before readers consume that version.
