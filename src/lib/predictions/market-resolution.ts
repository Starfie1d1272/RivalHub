/** RivalHub-confirmed domain facts only. Raw provider submissions are not this contract. */
export type MarketResolutionFact =
  | { state: "pending" | "void"; revision: string }
  | { state: "confirmed"; revision: string; winningKeys: readonly string[] };

export function resolveMarketOptions(
  options: readonly { id: string; key: string }[],
  fact: MarketResolutionFact,
): {
  state: "pending" | "settled" | "refunded";
  winningOptionIds: string[];
  factRevision: string;
} {
  if (fact.state !== "confirmed")
    return {
      state: fact.state === "void" ? "refunded" : "pending",
      winningOptionIds: [],
      factRevision: fact.revision,
    };
  const winners = [...new Set(fact.winningKeys)].sort();
  if (
    !winners.length ||
    winners.some((key) => !options.some((option) => option.key === key))
  )
    throw new Error("Confirmed outcome is not represented by this market");
  return {
    state: "settled",
    winningOptionIds: options
      .filter((option) => winners.includes(option.key))
      .map((option) => option.id)
      .sort(),
    factRevision: fact.revision,
  };
}
