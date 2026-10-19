import { z } from "zod";

/** A declared wire/relationship violation, distinct from a parser defect. */
export class DemoEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoEvidenceValidationError";
  }
}

export function isDemoEvidenceValidationError(error: unknown): error is z.ZodError | DemoEvidenceValidationError {
  return error instanceof z.ZodError || error instanceof DemoEvidenceValidationError;
}
