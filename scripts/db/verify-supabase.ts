import { verifySupabaseServices } from "./verification-contract";

verifySupabaseServices().catch((error) => {
  console.error(error);
  process.exit(1);
});
