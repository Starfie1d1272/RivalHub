"use server";

// TODO: registration form submission
// Validates position availability, stores registration, sends magic link
export async function submitRegistration(_formData: FormData): Promise<void> {
  throw new Error("not implemented");
}

// TODO: check if a position slot is still available
export async function checkPositionAvailability(
  _seasonId: string,
  _position: string
): Promise<{ available: boolean; count: number }> {
  throw new Error("not implemented");
}
