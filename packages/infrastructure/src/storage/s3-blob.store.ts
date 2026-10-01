import type { BlobStore } from '@hellogram/domain';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

export interface S3BlobStoreConfig {
  bucket: string;
  region: string;
  /** Omit both to use the server's IAM role / default credential chain. */
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  /** Only for S3-compatible stores (e.g. MinIO). */
  endpoint?: string | undefined;
}

/**
 * Private S3 bucket holding already-encrypted files. No pre-signed URLs are ever issued:
 * the only reader is the API, which checks who is asking before decrypting.
 */
export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;

  constructor(private readonly config: S3BlobStoreConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    });
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
        // Second layer at rest, on top of our own encryption.
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return result.Body ? await result.Body.transformToByteArray() : null;
    } catch (error) {
      if (error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
