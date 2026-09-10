export type PlayoffManagedKey =
  | "qf-1"
  | "qf-2"
  | "qf-3"
  | "qf-4"
  | "sf-1"
  | "sf-2"
  | "third-1"
  | "final-1";

export const PLAYOFF_PICK_KEYS = [
  "qf-1",
  "qf-2",
  "qf-3",
  "qf-4",
  "sf-1",
  "sf-2",
  "final-1",
] as const;

export function playoffDescendants(
  source: PlayoffManagedKey,
): ReadonlySet<PlayoffManagedKey> {
  switch (source) {
    case "qf-1":
    case "qf-2":
      return new Set(["sf-1", "final-1", "third-1"]);
    case "qf-3":
    case "qf-4":
      return new Set(["sf-2", "final-1", "third-1"]);
    case "sf-1":
    case "sf-2":
      return new Set(["final-1", "third-1"]);
    case "third-1":
    case "final-1":
      return new Set();
  }
}
