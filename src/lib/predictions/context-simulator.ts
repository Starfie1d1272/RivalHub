import { simulateQualification } from "@/lib/competition-qualification/simulation";
import { replaceSimulationChoice, simulateMajor } from "./simulator";
import type { Choices, SimMatch, SimulationContext } from "./types";

export function simulateContext(context: SimulationContext, choices: Choices) {
  return context.kind === "major"
    ? simulateMajor(context.baseline, choices, true)
    : simulateQualification(context, choices);
}

export function replaceContextChoice(
  context: SimulationContext,
  choices: Choices,
  stageKey: string,
  match: SimMatch,
  winner: string,
): Choices {
  if (context.kind === "major")
    return replaceSimulationChoice(
      context.baseline,
      choices,
      stageKey,
      match,
      winner,
    );
  if (![match.a, match.b].includes(winner)) throw new Error("胜者不是对阵方");
  const rows = simulateQualification(context, choices)[0]!.matches;
  const next = Object.fromEntries(
    Object.entries(choices).filter(([key]) => {
      const previous = rows.find((m) => key === `play-in/${m.key}`);
      return (
        previous && previous.round <= match.round && previous.key !== match.key
      );
    }),
  );
  next[`play-in/${match.key}`] = { a: match.a, b: match.b, winner };
  return next;
}
