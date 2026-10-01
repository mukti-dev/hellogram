import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3BlobStore } from './s3-blob.store.js';

/** A minimal stand-in for the S3 HTTP API: enough to check the requests we send and how we read replies. */
const objects = new Map<string, Buffer>();
const seen: { method: string; url: string; headers: Record<string, unknown> }[] = [];
let server: Server;
let store: S3BlobStore;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const key = (req.url ?? '').split('?')[0]!;
      seen.push({ method: req.method ?? '', url: key, headers: req.headers });
      if (req.method === 'PUT') {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { ETag: '"x"' }).end();
      } else if (req.method === 'GET') {
        const body = objects.get(key);
        if (body) res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length }).end(body);
        else res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>');
      } else if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204).end();
      } else {
        res.writeHead(405).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  store = new S3BlobStore({
    bucket: 'hellogram-test',
    region: 'ap-south-1',
    accessKeyId: 'AKIATESTTESTTESTTEST',
    secretAccessKey: 'test-secret',
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('S3BlobStore', () => {
  it('puts, gets and deletes an object', async () => {
    const body = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    await store.put('att/abc', body);

    const put = seen.find((r) => r.method === 'PUT')!;
    expect(put.url).toBe('/hellogram-test/att/abc');
    expect(put.headers['x-amz-server-side-encryption']).toBe('AES256');
    expect(put.headers['content-type']).toBe('application/octet-stream');
    expect(String(put.headers.authorization)).toContain('AWS4-HMAC-SHA256'); // signed, never anonymous
    expect(objects.get('/hellogram-test/att/abc')?.equals(body)).toBe(true);

    expect(Buffer.from((await store.get('att/abc'))!).equals(body)).toBe(true);
    await store.delete('att/abc');
    expect(objects.size).toBe(0);
  });

  it('returns null for an object that does not exist', async () => {
    expect(await store.get('att/missing')).toBeNull();
  });
});
