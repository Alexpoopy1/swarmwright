import crypto from "crypto";
import { env } from "@/server/env";

/**
 * AES-256-GCM encryption for provider API keys at rest.
 * Format: base64(iv).base64(tag).base64(ciphertext)
 *
 * Keys are decrypted lazily on the server only, never sent to the client,
 * and never written to logs.
 */
const ALGO = "aes-256-gcm";

function key(): Buffer {
  return crypto.createHash("sha256").update(env.SECRET_ENCRYPTION_KEY).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted secret");
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString(
    "utf8"
  );
}

/** Masked display form for the UI, e.g. "sk-…wxyz". */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 7) return "••••••";
  return `${plaintext.slice(0, 3)}…${plaintext.slice(-4)}`;
}
