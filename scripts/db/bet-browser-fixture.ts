import { z } from "zod";
import { db } from "@/db/client";
import { operateBetInTx } from "@/lib/bet/service";
import { assertLocalDatabaseUrl } from "./local-environment";

// Browser setup uses the canonical financial operation only on a disposable event.
assertLocalDatabaseUrl(process.env.DATABASE_URL);
const [seasonId, actorId] = z.tuple([z.guid(), z.guid()]).parse(process.argv.slice(2));
void db.transaction(tx => operateBetInTx(tx, { operation: "enable", seasonId, actorId })).then(() => process.exit(0), error => { console.error(error); process.exit(1); });
