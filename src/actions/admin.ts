"use server";

// TODO: admin login with invite code, sets iron-session cookie
export async function adminLogin(_inviteCode: string, _password: string): Promise<void> {
  throw new Error("not implemented");
}

// TODO: review a registration — approve / reject / waitlist
export async function reviewRegistration(
  _registrationId: string,
  _status: "approved" | "rejected" | "waitlisted"
): Promise<void> {
  throw new Error("not implemented");
}

// TODO: confirm captain candidates, generate teams + snake draft order
export async function confirmCaptains(_seasonId: string, _captainRegistrationIds: string[]): Promise<void> {
  throw new Error("not implemented");
}
