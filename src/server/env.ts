import { z } from "zod";

/**
 * Central, validated environment access. Import `env` — never read
 * process.env directly in feature code.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().default("file:./dev.db"),
  SECRET_ENCRYPTION_KEY: z
    .string()
    .min(16, "SECRET_ENCRYPTION_KEY must be at least 16 characters")
    .default("dev-only-insecure-key-change-me"),
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  SANDBOX_MEMORY_MB: z.coerce.number().int().positive().default(256),
  SANDBOX_NETWORK: z.enum(["allow", "deny"]).default("deny"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  SECRET_ENCRYPTION_KEY: process.env.SECRET_ENCRYPTION_KEY,
  SANDBOX_TIMEOUT_MS: process.env.SANDBOX_TIMEOUT_MS,
  SANDBOX_MEMORY_MB: process.env.SANDBOX_MEMORY_MB,
  SANDBOX_NETWORK: process.env.SANDBOX_NETWORK,
  NODE_ENV: process.env.NODE_ENV,
});

if (!parsed.success) {
  // Fail fast with a readable message rather than cryptic runtime errors.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export function isDefaultEncryptionKey(): boolean {
  return env.SECRET_ENCRYPTION_KEY === "dev-only-insecure-key-change-me";
}
