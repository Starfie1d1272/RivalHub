import { BUILT_IN_COMPETITIVE_PLATFORMS, isBuiltInCompetitivePlatformKey, isBuiltInStarRank } from "@/lib/competitive/builtins";
import { convertFiveeToPerfect } from "@/lib/competitive/conversion-policy";
import { comparePlayerStrengthFacts, type PlayerStrengthFact, type PlayerStrengthInput } from "@/lib/competitive/player-strength";
import { getDisplayName } from "@/lib/identity/display-name";
import type { CompetitiveProfileConfig } from "@/types/season";
import type { ParticipantQualificationFacts, QualificationPeak, QualificationSeasonPeak } from "@/lib/qualification/facts";
import type { ParticipantRules, QualificationEvidence } from "@/lib/seasons/rules";

type SelectableCompetitivePeak = QualificationPeak | QualificationSeasonPeak;

/** Each consumer evaluates only its own requirements, even when reads are batched. */
export type CompetitivePurpose = "profile_completeness" | "rank_threshold" | "external_historical_gap" | "seed_recommendation";

export function deriveCompetitiveRequirements(
  purposes: readonly CompetitivePurpose[],
  context: CompetitiveProfileConfig,
  participant: Pick<ParticipantRules, "rankThreshold">,
): Extract<QualificationEvidence, { kind: "competitive" }>["requirements"] {
  const weighted = purposes.includes("profile_completeness") || purposes.includes("seed_recommendation");
  const threshold = purposes.includes("rank_threshold") ? participant.rankThreshold : null;
  const seasonKeys = weighted
    ? [context.evidencePolicy?.referenceSeasonKey ?? context.previousSeasonKey, ...(context.evidencePolicy?.recentSeasonKeys ?? [context.currentSeasonKey])]
    : threshold?.currentMin ? [context.currentSeasonKey] : [];
  return {
    historicalPeak: weighted || purposes.includes("external_historical_gap") || Boolean(threshold?.peakMin),
    seasonKeys: [...new Set(seasonKeys.filter(Boolean))],
    ratingRequired: weighted,
    exactStarsRequired: weighted || purposes.includes("external_historical_gap"),
  };
}

/** Build one purpose's evidence from a shared read; never reuse a union as an evaluation. */
export function buildQualificationEvidence(
  facts: ReadonlyMap<string, ParticipantQualificationFacts>,
  context: CompetitiveProfileConfig,
  participant: Pick<ParticipantRules, "rankThreshold">,
  purpose: CompetitivePurpose,
): QualificationEvidence {
  const requirements = deriveCompetitiveRequirements([purpose], context, participant);
  if (!requirements.historicalPeak && requirements.seasonKeys.length === 0) return { kind: "none" };
  return {
    kind: "competitive",
    context: {
      profile: context,
      platform: context.platform,
      rankOrder: context.rankOrder,
      fallback: context.fallbackConversion ?? null,
      sourceSelection: context.evidencePolicy?.sourceSelection ?? "primary_then_fallback",
      evidencePolicy: context.evidencePolicy ?? null,
    },
    requirements,
    byUser: new Map([...facts].map(([id, fact]) => [id, selectPlayerStrengthEvidence({ ...fact, userId: id }, context, purpose, requirements.seasonKeys)])),
  };
}

export function createCompetitiveCandidateResolver(context: CompetitiveProfileConfig | null, purpose?: CompetitivePurpose): (
  primary: SelectableCompetitivePeak | null | undefined,
  fallbackFact: SelectableCompetitivePeak | null | undefined,
) => PlayerStrengthFact | null {
  const policy = context?.evidencePolicy;
  const fallback = context?.fallbackConversion;
  const sourceSelection = policy?.sourceSelection ?? "primary_then_fallback";
  const nativeCandidate = (primary: SelectableCompetitivePeak | null | undefined): PlayerStrengthFact | null => {
    // "Unranked" is evidence about the season state, not a rank. It must never
    // be silently rewritten to the bottom rung of the event ladder.
    if (primary?.status === "unranked") return null;
    if (!primary?.rank || ((primary.rating === null || primary.rating === undefined) && purpose !== "external_historical_gap" && purpose !== "rank_threshold")) return null;
    return {
      rank: primary.rank,
      rating: primary.rating ?? 0,
      ...(primary.rating == null ? { ratingComparable: false } : {}),
      stars: primary.stars ?? null,
      sourcePlatform: primary.sourcePlatform,
      sourceSeasonKey: primary.sourceSeasonKey,
      ...(primary.sourceRank !== undefined ? { sourceRank: primary.sourceRank } : {}),
    };
  };
  const fallbackCandidate = (fallbackFact: SelectableCompetitivePeak | null | undefined): PlayerStrengthFact | null => {
    if (!fallback || !fallbackFact || fallbackFact.status === "unranked") return null;
    if (!fallbackFact.rank || ((fallbackFact.rating === null || fallbackFact.rating === undefined) && purpose !== "external_historical_gap" && purpose !== "rank_threshold")) return null;
    if (fallback.mapping) {
      const converted = convertFiveeToPerfect(fallbackFact.rank, fallbackFact.stars ?? null, fallback.mapping);
      // A 5E Rating+ has no reviewed conversion to Perfect Rating Pro. It can
      // establish an equivalent rank, but must not participate in Rating Pro's
      // final tie-break.
      return converted
        ? {
            rank: converted.rank,
            rating: 0,
            ratingComparable: false,
            stars: converted.stars,
            sourcePlatform: fallback.sourcePlatform,
            sourceSeasonKey: fallbackFact.sourceSeasonKey,
            sourceRank: fallbackFact.rank,
            sourceStars: fallbackFact.stars ?? null,
            conversionVersion: fallback.version,
          }
        : null;
    }
    if (fallback.rankMap && Object.hasOwn(fallback.rankMap, fallbackFact.rank)) {
      return {
        rank: fallback.rankMap[fallbackFact.rank]!,
        rating: 0,
        ratingComparable: false,
        stars: null,
        sourcePlatform: fallback.sourcePlatform,
        sourceSeasonKey: fallbackFact.sourceSeasonKey,
        sourceRank: fallbackFact.rank,
        sourceStars: fallbackFact.stars ?? null,
        conversionVersion: fallback.version,
      };
    }
    return null;
  };
  const candidateIsUsable = (candidate: PlayerStrengthFact): boolean =>
    purpose === "rank_threshold" || !isBuiltInStarRank(context?.platform ?? "perfect_world", candidate.rank) || candidate.stars !== null && candidate.stars !== undefined;
  return (primary, fallbackFact) => {
    const native = nativeCandidate(primary);
    const converted = fallbackCandidate(fallbackFact);
    if (sourceSelection !== "strongest_equivalent") {
      // An explicitly unranked primary still gives a ranked fallback source the
      // opportunity to supply the season's usable evidence.
      if (primary?.status !== "unranked" && native) return native;
      return converted ?? native;
    }
    const usableNative = native && candidateIsUsable(native) ? native : null;
    const usableConverted = converted && candidateIsUsable(converted) ? converted : null;
    if (!usableNative) return usableConverted ?? native;
    if (!usableConverted) return usableNative;
    return comparePlayerStrengthFacts(usableConverted, usableNative, context!) > 0 ? usableConverted : usableNative;
  };
}

/** Adapts long-term facts to the event's frozen evidence policy in one place. */
function selectPlayerStrengthEvidence(
  fact: Pick<ParticipantQualificationFacts, "userId" | "displayName" | "perfectName" | "personaName" | "email" | "historicalPeak" | "seasonPeaks" | "platformSeasonOrder" | "fallbackFacts">,
  context: CompetitiveProfileConfig | null,
  purpose?: CompetitivePurpose,
  requestedSeasonKeys: readonly string[] = [],
) {
  const policy = context?.evidencePolicy;
  const fallback = context?.fallbackConversion;
  const resolve = createCompetitiveCandidateResolver(context, purpose);
  const fallbackFor = (seasonKey: string) => {
    const sourceSeasonKey = fallback?.seasonKeyMap[seasonKey];
    const source = sourceSeasonKey ? fact.fallbackFacts?.seasonPeaks.get(sourceSeasonKey) : undefined;
    return source
      ? { ...source, sourcePlatform: source.sourcePlatform ?? fallback?.sourcePlatform, sourceSeasonKey: source.sourceSeasonKey ?? sourceSeasonKey }
      : undefined;
  };
  const referenceSeasonKey = policy?.referenceSeasonKey ?? context?.previousSeasonKey ?? "";
  const recentSeasonKeys = policy?.recentSeasonKeys ?? (context?.currentSeasonKey ? [context.currentSeasonKey] : []);
  const evidenceSeasonKeys = [...new Set([
    referenceSeasonKey,
    ...recentSeasonKeys,
    context?.currentSeasonKey ?? "",
  ].filter(Boolean))];
  const catalogSeasonKeys = fact.platformSeasonOrder?.length
    ? fact.platformSeasonOrder
    : evidenceSeasonKeys;
  const seasonOrder = [...new Set([
    ...catalogSeasonKeys,
    ...evidenceSeasonKeys,
    ...(fact.seasonPeaks ? [...fact.seasonPeaks.keys()] : []),
  ])];
  const directForSeason = (seasonKey: string): PlayerStrengthFact | null =>
    resolve(fact.seasonPeaks?.get(seasonKey), fallbackFor(seasonKey));
  const lowerOneRung = (
    source: PlayerStrengthFact,
    targetSeasonKey: string,
    basis: { seasonKey?: string; historical?: boolean },
  ): PlayerStrengthFact | null => {
    if (!context) return null;
    const sourceRankIndex = context.rankOrder.indexOf(source.rank);
    if (sourceRankIndex < 0) return null;
    const rank = context.rankOrder[Math.max(0, sourceRankIndex - 1)]!;
    // A bucket estimate is not an observed star count. Use the lower bucket's
    // inclusive ceiling so continuous strength can consume it with provenance.
    const estimatedStars = isBuiltInCompetitivePlatformKey(context.platform)
      ? BUILT_IN_COMPETITIVE_PLATFORMS[context.platform].ranks.find(definition => definition.rankKey === rank)?.starMax ?? null
      : null;
    return {
      rank,
      rating: 0,
      ratingComparable: false,
      stars: estimatedStars,
      sourcePlatform: context.platform,
      sourceSeasonKey: targetSeasonKey,
      estimatedFromUnranked: true,
      ...(basis.seasonKey ? { estimatedFromSeasonKey: basis.seasonKey } : {}),
      ...(basis.historical ? { estimatedFromHistorical: true } : {}),
    };
  };
  const estimateUnrankedSeason = (seasonKey: string): PlayerStrengthFact | null => {
    if (!context) return null;
    const targetIndex = seasonOrder.indexOf(seasonKey);
    if (targetIndex >= 0) {
      // Prefer an actual earlier ranked season. Never chain an estimate from
      // another unranked season.
      for (let index = targetIndex - 1; index >= 0; index -= 1) {
        const sourceSeasonKey = seasonOrder[index]!;
        const source = directForSeason(sourceSeasonKey);
        if (!source) continue;
        return lowerOneRung(source, seasonKey, { seasonKey: sourceSeasonKey });
      }
    }

    // Last-resort estimate for profiles with no season-level ranked history.
    // Historical peak remains a declared ranked fact, but provenance is kept
    // explicit so the UI never presents the estimate as a real season result.
    const historical = resolve(fact.historicalPeak, fact.fallbackFacts?.historicalPeak);
    return historical ? lowerOneRung(historical, seasonKey, { historical: true }) : null;
  };
  const seasonFact = (seasonKey: string): PlayerStrengthFact | null => {
    const primary = fact.seasonPeaks?.get(seasonKey);
    const fallbackFact = fallbackFor(seasonKey);
    const direct = resolve(primary, fallbackFact);
    if (direct || !context || (primary?.status !== "unranked" && fallbackFact?.status !== "unranked")) return direct;
    return estimateUnrankedSeason(seasonKey);
  };
  const strength: PlayerStrengthInput = {
    userId: fact.userId ?? "",
    label: getDisplayName(fact),
    historicalPeak: resolve(fact.historicalPeak, fact.fallbackFacts?.historicalPeak),
    previousSeasonPeak: purpose === "external_historical_gap" || purpose === "rank_threshold" ? null : seasonFact(referenceSeasonKey),
    currentSeasonPeak: purpose === "external_historical_gap" ? null : purpose === "rank_threshold"
      ? directForSeason(context?.currentSeasonKey ?? "")
      : seasonFact(context?.currentSeasonKey ?? ""),
    recentSeasonPeaks: purpose === "external_historical_gap" || purpose === "rank_threshold" ? [] : recentSeasonKeys.map(seasonFact),
  };
  return {
    strength,
    historicalPeak: strength.historicalPeak,
    seasons: new Map(requestedSeasonKeys.map((key) => [key, purpose === "rank_threshold" ? directForSeason(key) : seasonFact(key)])),
  };
}

/** Compatibility adapter; new consumers use purpose-specific QualificationEvidence. */
export function toPlayerStrengthInput(
  fact: Pick<ParticipantQualificationFacts, "userId" | "displayName" | "perfectName" | "personaName" | "email" | "historicalPeak" | "seasonPeaks" | "platformSeasonOrder" | "fallbackFacts">,
  context: CompetitiveProfileConfig | null,
  purpose?: CompetitivePurpose,
): PlayerStrengthInput {
  return selectPlayerStrengthEvidence(fact, context, purpose).strength;
}

