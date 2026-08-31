export type SemanticTone = "neutral" | "info" | "success" | "warn" | "danger" | "accent";

export interface StatusPresentation {
  label: string;
  tone: SemanticTone;
}
