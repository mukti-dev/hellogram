import { LIMITS, type AttachmentDto } from '@hellogram/shared';
import { useEffect, useState } from 'react';
import { chatApi } from '../api/chat.api.js';

/**
 * Decrypted files live only in this tab's memory, as blob: URLs.
 * Nothing is written to the browser cache or disk (the API also answers `no-store`).
 */
const MAX_CACHED = 40;
const cache = new Map<string, Promise<string>>();

function remember(id: string, url: Promise<string>): Promise<string> {
  cache.delete(id);
  cache.set(id, url);
  // Least recently used out first.
  for (const [oldId, oldUrl] of cache) {
    if (cache.size <= MAX_CACHED) break;
    cache.delete(oldId);
    void oldUrl.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  }
  return url;
}

export function attachmentUrl(id: string): Promise<string> {
  const cached = cache.get(id);
  if (cached) return remember(id, cached);
  const url = chatApi.downloadAttachment(id).then((blob) => URL.createObjectURL(blob));
  url.catch(() => cache.delete(id));
  return remember(id, url);
}

/** The sender already has the file: no need to download what was just uploaded. */
export function seedAttachment(id: string, file: Blob): void {
  remember(id, Promise.resolve(URL.createObjectURL(file)));
}

/** The message was deleted: drop the decrypted copy from memory too. */
export function forgetAttachment(id: string): void {
  const url = cache.get(id);
  cache.delete(id);
  void url?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
}

/** Logout: nothing from the previous user stays in memory. */
export function clearAttachmentCache(): void {
  for (const url of cache.values()) void url.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  cache.clear();
}

export function useAttachmentUrl(id: string | null): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ id: string | null; url: string | null; failed: boolean }>({ id: null, url: null, failed: false });
  useEffect(() => {
    if (!id) return;
    let active = true;
    attachmentUrl(id).then(
      (url) => active && setState({ id, url, failed: false }),
      () => active && setState({ id, url: null, failed: true }),
    );
    return () => {
      active = false;
    };
  }, [id]);
  return state.id === id ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}

export async function saveAttachment(attachment: AttachmentDto): Promise<void> {
  const url = await attachmentUrl(attachment.id);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.fileName;
  link.click();
}

export const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,.docx,.xlsx,.pptx,.zip,.txt,.csv';

const MAX_IMAGE_SIDE = 2048;
const RE_ENCODE: Record<string, { type: string; quality?: number }> = {
  'image/jpeg': { type: 'image/jpeg', quality: 0.85 },
  'image/png': { type: 'image/png' },
  'image/webp': { type: 'image/webp', quality: 0.85 },
};

/**
 * Photos are redrawn before upload: that bakes in the rotation, drops EXIF (camera, GPS location)
 * and caps the size at 2048 px. The server strips metadata again, so this is not the only safeguard.
 */
export async function prepareFile(file: File): Promise<Blob> {
  const target = RE_ENCODE[file.type];
  if (!target || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    // PNG / WebP carry no rotation: only redraw them when they need shrinking.
    if (scale === 1 && file.type !== 'image/jpeg') {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, target.type, target.quality));
    return blob ?? file;
  } catch {
    return file; // not decodable here — the server decides
  }
}

export const tooLarge = (file: Blob) => file.size > LIMITS.ATTACHMENT_MAX_BYTES;

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
