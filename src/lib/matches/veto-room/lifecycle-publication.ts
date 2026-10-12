import "server-only";
import contract from "./lifecycle-contract.json";

/** Immutable build capability; gameplay safety never depends on publication. */
const lifecycleContract = Object.freeze({ ...contract });
export function canPublishVetoAppealClosure(): boolean {
  return lifecycleContract.publisherVersion >= 1;
}
