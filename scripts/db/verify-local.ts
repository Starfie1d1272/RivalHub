import { verifyDatabaseContract, verifySupabaseServices } from "./verification-contract";

async function main(): Promise<void> {
  await verifyDatabaseContract();
  await verifySupabaseServices();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
