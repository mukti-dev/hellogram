import type { BlobStore, FileCipher } from '@hellogram/domain';
import { AesGcmFileCipher } from '../security/aes-gcm-file.cipher.js';
import { LocalDiskBlobStore } from './local-blob.store.js';
import { S3BlobStore } from './s3-blob.store.js';

export interface AttachmentStorageConfig {
  ATTACHMENT_STORAGE: 'local' | 's3';
  ATTACHMENT_DIR: string;
  ATTACHMENT_ENCRYPTION_KEY: string;
  ATTACHMENT_ENCRYPTION_KEYS_OLD: string[];
  S3_BUCKET?: string | undefined;
  S3_REGION: string;
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
  S3_ENDPOINT?: string | undefined;
}

/** The same storage and keys for the API (upload/download) and the worker (clean-up). */
export function createAttachmentStorage(env: AttachmentStorageConfig): { blobs: BlobStore; cipher: FileCipher } {
  const blobs =
    env.ATTACHMENT_STORAGE === 's3'
      ? new S3BlobStore({
          bucket: env.S3_BUCKET ?? '',
          region: env.S3_REGION,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          endpoint: env.S3_ENDPOINT,
        })
      : new LocalDiskBlobStore(env.ATTACHMENT_DIR);
  return { blobs, cipher: new AesGcmFileCipher(env.ATTACHMENT_ENCRYPTION_KEY, env.ATTACHMENT_ENCRYPTION_KEYS_OLD) };
}
