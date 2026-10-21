import { constants, createHash, createPublicKey, publicEncrypt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { PREVIEW_PROJECT_REF } from "../../src/lib/runtime/preview.ts";

const key = createPublicKey(process.env.RIVALHUB_STANDBY_OPERATOR_PUBLIC_KEY ?? "");
if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 4096) throw new Error("RSA-4096 operator public key required.");
const password = process.env.RIVALHUB_STAGING_DB_PASSWORD;
if (!password || password === "[SENSITIVE]") throw new Error("Protected Preview database credential unavailable.");
const fingerprint = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
const sealed = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(password));
mkdirSync(".agent-tmp/standby-credential", { recursive: true });
writeFileSync(".agent-tmp/standby-credential/preview-db-password.sealed.json", JSON.stringify({
  projectRef: PREVIEW_PROJECT_REF, recipient: fingerprint, algorithm: "RSA-OAEP-SHA256", ciphertext: sealed.toString("base64"),
}) + "\n");
console.log(`Preview credential sealed for operator ${fingerprint}.`);
