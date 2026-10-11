import "server-only";
import contract from "./ledger-contract.json";

/** Immutable build capability. Publication changes require a reader-first release. */
const ledgerContract = Object.freeze({ ...contract });
export function canPublishBetRelief(): boolean {
  return ledgerContract.publisherVersion >= 1;
}
