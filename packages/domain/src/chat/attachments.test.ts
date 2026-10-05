import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { inspectFile, normalizeWaveform, sanitizeFileName } from './attachments.js';

const bytes = (...parts: (number[] | string | Uint8Array)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : [...p])));
const has = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));
const be16 = (n: number) => [n >> 8, n & 0xff];
const be32 = (n: number) => [0, 0, n >> 8, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, 0, 0];
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'other';
  }
  return 'none';
};

const jpegSegment = (marker: number, payload: number[] | string) => {
  const data = typeof payload === 'string' ? [...Buffer.from(payload, 'latin1')] : payload;
  return [0xff, marker, ...be16(data.length + 2), ...data];
};
const JPEG = bytes(
  [0xff, 0xd8],
  jpegSegment(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
  jpegSegment(0xe1, 'Exif\0\0GPS-LAT-12.97-LON-77.59'),
  jpegSegment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<xmp>owner</xmp>'),
  jpegSegment(0xfe, 'a comment'),
  jpegSegment(0xc0, [8, ...be16(16), ...be16(32), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  jpegSegment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
  'scan-data',
  [0xff, 0xd9],
);

const pngChunk = (type: string, data: number[] | string) => {
  const payload = typeof data === 'string' ? [...Buffer.from(data, 'latin1')] : data;
  return [...be32(payload.length), ...Buffer.from(type, 'latin1'), ...payload, 0, 0, 0, 0];
};
const PNG = bytes(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  pngChunk('IHDR', [...be32(5), ...be32(7), 8, 6, 0, 0, 0]),
  pngChunk('tEXt', 'Author\0Secret Person'),
  pngChunk('eXIf', 'GPS-HERE'),
  pngChunk('IDAT', 'pixels'),
  pngChunk('IEND', []),
  'hidden-trailer',
);

const webpChunk = (type: string, data: number[] | string) => {
  const payload = typeof data === 'string' ? [...Buffer.from(data, 'latin1')] : data;
  return [...Buffer.from(type, 'latin1'), ...le32(payload.length), ...payload, ...(payload.length % 2 ? [0] : [])];
};
const webpBody = [
  ...webpChunk('VP8X', [0x08 | 0x04 | 0x10, 0, 0, 0, 99, 0, 0, 49, 0, 0]),
  ...webpChunk('VP8 ', 'frame-data'),
  ...webpChunk('EXIF', 'GPS-SECRET'),
  ...webpChunk('XMP ', '<xmp>owner</xmp>'),
];
const WEBP = bytes('RIFF', le32(webpBody.length + 4), 'WEBP', webpBody);

describe('inspectFile', () => {
  it('strips EXIF/GPS, XMP and comments from a JPEG and reads its size', () => {
    const out = inspectFile(JPEG, 'IMG_0001.JPG');
    expect(out).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', fileName: 'IMG_0001.jpg', width: 32, height: 16 });
    expect(has(JPEG, 'GPS-LAT')).toBe(true);
    for (const secret of ['GPS-LAT', 'Exif', 'xmp', 'a comment']) expect(has(out.bytes, secret)).toBe(false);
    expect(has(out.bytes, 'JFIF')).toBe(true);
    expect(has(out.bytes, 'scan-data')).toBe(true);
  });

  it('strips text and EXIF chunks and trailing data from a PNG', () => {
    const out = inspectFile(PNG, 'shot.png');
    expect(out).toMatchObject({ kind: 'image', mimeType: 'image/png', width: 5, height: 7 });
    for (const secret of ['Secret Person', 'GPS-HERE', 'hidden-trailer']) expect(has(out.bytes, secret)).toBe(false);
    expect(has(out.bytes, 'pixels')).toBe(true);
  });

  it('strips EXIF and XMP from a WebP and keeps the container consistent', () => {
    const out = inspectFile(WEBP, 'pic.webp');
    expect(out).toMatchObject({ kind: 'image', mimeType: 'image/webp', width: 100, height: 50 });
    for (const secret of ['GPS-SECRET', 'owner']) expect(has(out.bytes, secret)).toBe(false);
    expect(has(out.bytes, 'frame-data')).toBe(true);
    const view = Buffer.from(out.bytes);
    expect(view.readUInt32LE(4)).toBe(out.bytes.byteLength - 8);
    expect(view[20]).toBe(0x10); // EXIF + XMP flags cleared, alpha flag kept
  });

  it('accepts a GIF', () => {
    const out = inspectFile(bytes('GIF89a', [10, 0, 20, 0], 'rest'), 'fun.gif');
    expect(out).toMatchObject({ kind: 'image', mimeType: 'image/gif', width: 10, height: 20 });
  });

  it('decides by content, not by the name', () => {
    // A PDF called .jpg is a PDF; a JPEG called .pdf is an image.
    expect(inspectFile(bytes('%PDF-1.7 ...'), 'holiday.jpg')).toMatchObject({ kind: 'file', mimeType: 'application/pdf', fileName: 'holiday.pdf' });
    expect(inspectFile(JPEG, 'report.pdf')).toMatchObject({ kind: 'image', fileName: 'report.jpg' });
  });

  it('accepts Office files and ZIPs only under their own extensions', () => {
    const zip = bytes([0x50, 0x4b, 0x03, 0x04], 'zip-content');
    expect(inspectFile(zip, 'quote.docx').mimeType).toContain('wordprocessingml');
    expect(inspectFile(zip, 'sheet.XLSX').mimeType).toContain('spreadsheetml');
    expect(inspectFile(zip, 'photos.zip').mimeType).toBe('application/zip');
    expect(codeOf(() => inspectFile(zip, 'app.apk'))).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(codeOf(() => inspectFile(zip, 'tool.jar'))).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('accepts plain text only as .txt / .csv', () => {
    expect(inspectFile(bytes('name,price\nbike,5000\n'), 'list.csv').mimeType).toBe('text/csv');
    expect(codeOf(() => inspectFile(bytes([0x41, 0x00, 0x42]), 'notes.txt'))).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('refuses web pages, scripts, SVG and programs', () => {
    const refused: [string, Uint8Array][] = [
      ['page.html', bytes('<html><script>alert(1)</script></html>')],
      ['logo.svg', bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
      ['run.js', bytes('fetch("/v1/me")')],
      ['setup.exe', bytes('MZ\x90\0\x03')],
      ['script.sh', bytes('#!/bin/sh\nrm -rf /')],
      ['noextension', bytes('just text')],
    ];
    for (const [name, content] of refused) expect(codeOf(() => inspectFile(content, name))).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('refuses broken images, empty files and files over 10 MB', () => {
    expect(codeOf(() => inspectFile(bytes([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]), 'bad.jpg'))).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(codeOf(() => inspectFile(new Uint8Array(0), 'empty.txt'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => inspectFile(new Uint8Array(10 * 1024 * 1024 + 1), 'big.pdf'))).toBe('FILE_TOO_LARGE');
  });
});

describe('sanitizeFileName', () => {
  it('drops folders, control characters and misleading extensions', () => {
    expect(sanitizeFileName('../../etc/passwd', 'txt')).toBe('passwd.txt');
    expect(sanitizeFileName('C:\\Users\\me\\invoice.final.PDF', 'pdf')).toBe('invoice.final.pdf');
    expect(sanitizeFileName('photo.jpg.exe', 'jpg')).toBe('photo.jpg.jpg');
    expect(sanitizeFileName('bad\u0000\nname<>.png', 'png')).toBe('badname.png');
    expect(sanitizeFileName('.htaccess', 'txt')).toBe('file.txt');
    expect(sanitizeFileName('रसीद 2026.pdf', 'pdf')).toBe('रसीद 2026.pdf');
    expect(sanitizeFileName('x'.repeat(500), 'pdf')).toHaveLength(120);
  });
});

describe('videos, audio, voice messages and stickers', () => {
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const box = (type: string, ...payload: number[][]) => {
    const body = payload.flat();
    return [...u32(body.length + 8), ...Buffer.from(type, 'latin1'), ...body];
  };
  const str = (s: string) => [...Buffer.from(s, 'latin1')];
  // mvhd v0: version/flags, created, modified, timescale 1000, duration 4200 ms.
  const mvhd = box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(4200), new Array(80).fill(0));
  const hdlr = (handler: string) => box('hdlr', [0, 0, 0, 0], u32(0), str(handler), new Array(12).fill(0), [0]);
  const trak = (handler: string) => box('trak', box('mdia', hdlr(handler)));
  const mp4 = (brand: string, ...tracks: string[]) =>
    Uint8Array.from([
      ...box('ftyp', str(brand), u32(0), str('isom')),
      ...box('moov', mvhd, ...tracks.map(trak), box('udta', box('meta', str('+12.9716+077.5946/ GPS of home')))),
      ...box('mdat', str('audio-and-video-samples')),
    ]);

  it('accepts phone videos as files and blanks their location metadata in place', () => {
    const input = mp4('qt  ', 'vide', 'soun');
    const out = inspectFile(input, 'IMG_0042.MOV');
    expect(out).toMatchObject({ kind: 'file', mimeType: 'video/quicktime', fileName: 'IMG_0042.mov' });
    expect(out.bytes.byteLength).toBe(input.byteLength); // offsets stay valid
    expect(has(out.bytes, 'GPS of home')).toBe(false);
    expect(has(out.bytes, 'audio-and-video-samples')).toBe(true);
    expect(inspectFile(mp4('mp42', 'vide'), 'clip.mov')).toMatchObject({ mimeType: 'video/mp4', fileName: 'clip.mp4' });
  });

  it('accepts audio files (M4A, MP3, WAV)', () => {
    expect(inspectFile(mp4('M4A ', 'soun'), 'song.m4a')).toMatchObject({ kind: 'file', mimeType: 'audio/mp4' });
    expect(inspectFile(bytes('ID3', [4, 0, 0], 'frames'), 'song.mp3')).toMatchObject({ mimeType: 'audio/mpeg', fileName: 'song.mp3' });
    expect(inspectFile(bytes('RIFF', le32(100), 'WAVEfmt '), 'note.wav')).toMatchObject({ mimeType: 'audio/wav' });
  });

  it('voice messages must be audio-only recordings, with their length read from the file', () => {
    const out = inspectFile(mp4('M4A ', 'soun'), 'whatever.bin', 'voice');
    expect(out).toMatchObject({ kind: 'voice', mimeType: 'audio/mp4', fileName: 'Voice message.m4a', durationMs: 4200 });
    expect(has(out.bytes, 'GPS of home')).toBe(false);
    expect(codeOf(() => inspectFile(mp4('mp42', 'vide', 'soun'), 'v.m4a', 'voice'))).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(codeOf(() => inspectFile(bytes('%PDF-1.7'), 'v.m4a', 'voice'))).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('stickers are small PNG/WebP/GIF images, never JPEGs or other files', () => {
    expect(inspectFile(PNG, 'hi.png', 'sticker')).toMatchObject({ kind: 'sticker', mimeType: 'image/png' });
    expect(codeOf(() => inspectFile(JPEG, 'hi.jpg', 'sticker'))).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(codeOf(() => inspectFile(bytes('%PDF-1.7'), 'hi.png', 'sticker'))).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('cleans up the waveform the app sends', () => {
    expect(normalizeWaveform([3, 40, -2, 'x', 12.6])).toEqual([3, 31, 0, 0, 13]);
    expect(normalizeWaveform(new Array(100).fill(5))).toHaveLength(64);
    expect(normalizeWaveform('nope')).toBeNull();
  });
});
