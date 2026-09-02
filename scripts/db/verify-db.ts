import { verifyDatabaseContract } from "./verification-contract";

verifyDatabaseContract().catch((error) => {
  console.error(error);
  process.exit(1);
});
