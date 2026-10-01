import { z } from 'zod';

/** Only for local development. Production must set its own key (the API and worker refuse to start otherwise). */
export const DEV_ATTACHMENT_KEY = 'ZGV2LW9ubHktaGVsbG9ncmFtLWZpbGUta2V5LTAwMDE=';

const isKey = (value: string) => Buffer.from(value.trim(), 'base64').length === 32;

/** Chat attachment storage, shared by the API (upload/download) and the worker (clean-up). */
export const storageEnvSchema = z.object({
  /** `s3` in production; `local` keeps the (still encrypted) files in ATTACHMENT_DIR. */
  ATTACHMENT_STORAGE: z.enum(['local', 's3']).default('local'),
  /** Relative to the app's folder; the default is `<repo>/.data/private` for both the API and the worker. */
  ATTACHMENT_DIR: z.string().default('../../.data/private'),
  /** 32 random bytes, base64: `openssl rand -base64 32`. Losing it makes every stored file unreadable. */
  ATTACHMENT_ENCRYPTION_KEY: z.string().default(DEV_ATTACHMENT_KEY),
  /** Earlier keys, comma-separated, kept only so older files stay readable after a rotation. */
  ATTACHMENT_ENCRYPTION_KEYS_OLD: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((k) => k.trim()).filter(Boolean)),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  /** Leave both empty to use the server's IAM role. */
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** S3-compatible stores only (e.g. MinIO). */
  S3_ENDPOINT: z.url().optional(),
});

export type StorageEnv = z.infer<typeof storageEnvSchema>;

export function checkStorage(env: StorageEnv & { NODE_ENV: string }, addIssue: (path: string, message: string) => void) {
  if (!isKey(env.ATTACHMENT_ENCRYPTION_KEY)) {
    addIssue('ATTACHMENT_ENCRYPTION_KEY', 'must be 32 bytes, base64-encoded (openssl rand -base64 32)');
  }
  if (env.ATTACHMENT_ENCRYPTION_KEYS_OLD.some((key) => !isKey(key))) {
    addIssue('ATTACHMENT_ENCRYPTION_KEYS_OLD', 'every key must be 32 bytes, base64-encoded');
  }
  if (env.ATTACHMENT_STORAGE === 's3' && !env.S3_BUCKET) addIssue('S3_BUCKET', 'required when ATTACHMENT_STORAGE=s3');
  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
    addIssue('S3_SECRET_ACCESS_KEY', 'set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (IAM role)');
  }
  if (env.NODE_ENV === 'production') {
    if (env.ATTACHMENT_ENCRYPTION_KEY === DEV_ATTACHMENT_KEY) {
      addIssue('ATTACHMENT_ENCRYPTION_KEY', 'must be set to your own key in production');
    }
    if (env.ATTACHMENT_STORAGE !== 's3') addIssue('ATTACHMENT_STORAGE', 'must be s3 in production');
  }
}
