import { verifyAuthService } from "./verification-contract";

verifyAuthService().catch((error) => {
  console.error(error);
  process.exit(1);
});
