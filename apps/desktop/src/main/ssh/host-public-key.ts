import { z } from "zod";

export const hostPublicKeySchema = z
  .object({
    algorithm: z
      .string()
      .regex(
        /^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521)|rsa-sha2-(?:256|512))$/,
      ),
    key: z
      .string()
      .min(1)
      .max(16_384)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .refine((value) => {
        const decoded = Buffer.from(value, "base64");
        return (
          decoded.length > 0 &&
          decoded.toString("base64").replace(/=+$/, "") ===
            value.replace(/=+$/, "")
        );
      }),
  })
  .strict();

export type HostPublicKey = z.infer<typeof hostPublicKeySchema>;

export function parseOpenSshPublicKey(value: string) {
  const [algorithm, key, ...extra] = value.trim().split(/\s+/);
  if (extra.length > 0) return undefined;
  const parsed = hostPublicKeySchema.safeParse({ algorithm, key });
  return parsed.success ? parsed.data : undefined;
}
