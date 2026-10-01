import { ErrorCode, LIMITS } from '@hellogram/shared';
import { DomainError } from '../errors/domain-error.js';

export type AttachmentKind = 'image' | 'file';

/** What a message carries about its file. The storage location never leaves the server. */
export interface MessageAttachment {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface Attachment extends MessageAttachment {
  conversationId: string;
  uploaderPersonaId: string;
  /** Null until the upload is sent as a message. */
  messageId: string | null;
  storageKey: string;
  createdAt: Date;
}

export interface InspectedFile {
  kind: AttachmentKind;
  mimeType: string;
  fileName: string;
  /** The bytes to store: images have their metadata (EXIF/GPS, XMP, comments) removed. */
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
}

const notAllowed = () =>
  new DomainError(
    ErrorCode.FILE_TYPE_NOT_ALLOWED,
    'This file type can’t be sent. You can share photos (JPG, PNG, WebP, GIF), PDF, Word, Excel, PowerPoint, ZIP and text files.',
  );

const ascii = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));
const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number) => u16le(b, at) | ((b[at + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, at: number) => u16be(b, at) * 0x10000 + u16be(b, at + 2);
const u32le = (b: Uint8Array, at: number) => u16le(b, at) + u16le(b, at + 2) * 0x10000;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

interface Cleaned {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * JPEG: keep only what decoding needs. APP1 (EXIF with GPS, XMP), APP13 (IPTC) and comments
 * are dropped; APP0 (JFIF), APP2 (colour profile) and APP14 (Adobe colour transform) stay.
 */
function cleanJpeg(b: Uint8Array): Cleaned | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let at = 2;
  while (at + 4 <= b.byteLength) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Start of scan / end of image: the rest is compressed data, copied as-is.
    if (marker === 0xda || marker === 0xd9) {
      parts.push(b.subarray(at));
      return width > 0 && height > 0 ? { bytes: concat(parts), width, height } : null;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(b.subarray(at, at + 2));
      at += 2;
      continue;
    }
    const length = u16be(b, at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > b.byteLength) return null;
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      height = u16be(b, at + 5);
      width = u16be(b, at + 7);
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = isApp ? marker === 0xe0 || marker === 0xe2 || marker === 0xee : marker !== 0xfe;
    if (keep) parts.push(b.subarray(at, end));
    at = end;
  }
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** PNG: drop EXIF and text chunks, and anything after the end-of-image chunk. */
function cleanPng(b: Uint8Array): Cleaned | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let width = 0;
  let height = 0;
  let at = 8;
  while (at + 12 <= b.byteLength) {
    const length = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + length;
    if (end > b.byteLength) return null;
    if (type === 'IHDR') {
      width = u32be(b, at + 8);
      height = u32be(b, at + 12);
    }
    if (!PNG_DROP.has(type)) parts.push(b.subarray(at, end));
    if (type === 'IEND') return width > 0 && height > 0 ? { bytes: concat(parts), width, height } : null;
    at = end;
  }
  return null;
}

/** WebP: drop the EXIF and XMP chunks and clear their flags in the extended header. */
function cleanWebp(b: Uint8Array): Cleaned | null {
  const chunks: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let at = 12;
  while (at + 8 <= b.byteLength) {
    const type = ascii(b, at, 4);
    const size = u32le(b, at + 4);
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > b.byteLength) return null;
    const data = at + 8;
    if (type === 'VP8X') {
      const chunk = b.slice(at, Math.min(end, b.byteLength));
      chunk[8] = (chunk[8] ?? 0) & ~0x0c; // EXIF (0x08) and XMP (0x04) flags
      width = u24le(b, data + 4) + 1;
      height = u24le(b, data + 7) + 1;
      chunks.push(chunk);
    } else if (type === 'EXIF' || type === 'XMP ') {
      // dropped
    } else {
      if (type === 'VP8 ' && width === 0) {
        width = u16le(b, data + 6) & 0x3fff;
        height = u16le(b, data + 8) & 0x3fff;
      } else if (type === 'VP8L' && width === 0) {
        const bits = u32le(b, data + 1);
        width = (bits & 0x3fff) + 1;
        height = (Math.floor(bits / 0x4000) & 0x3fff) + 1;
      }
      chunks.push(b.subarray(at, Math.min(end, b.byteLength)));
    }
    at = end;
  }
  if (width <= 0 || height <= 0 || chunks.length === 0) return null;
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 4));
  const riffSize = body.byteLength + 4;
  header.set([riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, (riffSize >>> 24) & 0xff], 4);
  header.set(b.subarray(8, 12), 8);
  return { bytes: concat([header, body]), width, height };
}

function cleanGif(b: Uint8Array): Cleaned | null {
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  return width > 0 && height > 0 ? { bytes: b, width, height } : null;
}

const startsWith = (b: Uint8Array, signature: number[]) => signature.every((byte, i) => b[i] === byte);

const IMAGE_TYPES: { mimeType: string; ext: string; matches: (b: Uint8Array) => boolean; clean: (b: Uint8Array) => Cleaned | null }[] = [
  { mimeType: 'image/jpeg', ext: 'jpg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]), clean: cleanJpeg },
  { mimeType: 'image/png', ext: 'png', matches: (b) => startsWith(b, PNG_SIGNATURE), clean: cleanPng },
  { mimeType: 'image/webp', ext: 'webp', matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP', clean: cleanWebp },
  { mimeType: 'image/gif', ext: 'gif', matches: (b) => ['GIF87a', 'GIF89a'].includes(ascii(b, 0, 6)), clean: cleanGif },
];

/** ZIP containers are only accepted under these names (an .apk or .jar is a ZIP too). */
const ZIP_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

const TEXT_TYPES: Record<string, string> = { txt: 'text/plain', csv: 'text/csv' };

function isPlainText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

const MAX_IMAGE_SIDE = 12_000;

/** A safe display name: no folders, no control characters, and always the extension we detected. */
export function sanitizeFileName(input: string, ext: string): string {
  const base = (input.split(/[\\/]/).pop() ?? '')
    .replace(/\p{Cc}/gu, '')
    .replace(/[<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/^\.+/, '').replace(/[. ]+$/, '');
  const suffix = `.${ext}`;
  return `${(stem || 'file').slice(0, LIMITS.ATTACHMENT_NAME_MAX - suffix.length)}${suffix}`;
}

const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? '';

/**
 * Decides what a file is from its *content* (never from the type the client claims),
 * and strips location and other metadata from images.
 * Anything not on the allow-list is refused — notably HTML, SVG, scripts and executables.
 */
export function inspectFile(bytes: Uint8Array, claimedName: string): InspectedFile {
  if (bytes.byteLength === 0) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'This file is empty');
  if (bytes.byteLength > LIMITS.ATTACHMENT_MAX_BYTES) {
    throw new DomainError(ErrorCode.FILE_TOO_LARGE, 'Files can be up to 10 MB');
  }

  const image = IMAGE_TYPES.find((type) => type.matches(bytes));
  if (image) {
    const cleaned = image.clean(bytes);
    if (!cleaned || cleaned.width > MAX_IMAGE_SIDE || cleaned.height > MAX_IMAGE_SIDE) {
      throw new DomainError(ErrorCode.FILE_TYPE_NOT_ALLOWED, 'This image can’t be read. Try another one.');
    }
    return {
      kind: 'image',
      mimeType: image.mimeType,
      fileName: sanitizeFileName(claimedName, image.ext),
      bytes: cleaned.bytes,
      width: cleaned.width,
      height: cleaned.height,
    };
  }

  const ext = extensionOf(claimedName);
  const file = (mimeType: string, as: string): InspectedFile => ({
    kind: 'file',
    mimeType,
    fileName: sanitizeFileName(claimedName, as),
    bytes,
    width: null,
    height: null,
  });

  if (ascii(bytes, 0, 5) === '%PDF-') return file('application/pdf', 'pdf');
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const mimeType = ZIP_TYPES[ext];
    if (mimeType) return file(mimeType, ext);
    throw notAllowed();
  }
  const textType = TEXT_TYPES[ext];
  if (textType && isPlainText(bytes)) return file(textType, ext);
  throw notAllowed();
}

/** Shown in the inbox and in push notifications when a message has no caption. */
export const attachmentLabel = (a: Pick<MessageAttachment, 'kind' | 'fileName'>) => (a.kind === 'image' ? 'Photo' : a.fileName);
