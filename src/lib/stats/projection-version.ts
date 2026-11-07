import declaration from "./projection-contract.json";
import { readStatisticsProjectionContract } from "./projection-contract";

/** Versioned projections coexist during cutover; old readers use their exact version. */
const contract = readStatisticsProjectionContract(declaration);
export const PREVIOUS_STATISTICS_PROJECTION_VERSION = contract.previous;
export const STATISTICS_PROJECTION_VERSION = contract.current;
