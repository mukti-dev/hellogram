/**
 * Just enough ISO-BMFF (MP4 / MOV / M4A) parsing to accept phone videos and voice notes:
 * what the file is, how long it lasts, and blanking its metadata in place.
 */

const ascii = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));
const u32 = (b: Uint8Array, at: number) => ((b[at] ?? 0) * 0x1000000 + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0)) >>> 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 0x100000000 + u32(b, at + 4);

interface Box {
  type: string;
  start: number;
  /** Where the payload starts (after the size/type header). */
  body: number;
  end: number;
}

/** The boxes directly inside [from, to). Null when the structure is broken. */
function boxes(b: Uint8Array, from: number, to: number): Box[] | null {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(b, at);
    const type = ascii(b, at + 4, 4);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) return null;
      size = u64(b, at + 8);
      body = at + 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < body - at || at + size > to) return null;
    out.push({ type, start: at, body, end: at + size });
    at += size;
  }
  return at === to ? out : null;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'edts']);
/** Boxes that only carry descriptive metadata (titles, device, GPS location…). */
const METADATA = new Set(['udta', 'meta', 'uuid', 'XMP_']);

export interface Mp4Info {
  /** ftyp major brand, e.g. 'isom', 'mp42', 'qt  ', 'M4A '. */
  brand: string;
  hasVideo: boolean;
  hasAudio: boolean;
  durationMs: number;
  /** Same length as the input: metadata boxes turned into zero-filled `free` boxes. */
  bytes: Uint8Array;
}

/**
 * Parses an MP4-family file. Metadata boxes are overwritten with `free` boxes of the same size
 * rather than removed, so the sample offsets inside the file stay valid.
 */
export function readMp4(input: Uint8Array): Mp4Info | null {
  if (ascii(input, 4, 4) !== 'ftyp') return null;
  const top = boxes(input, 0, input.byteLength);
  const ftyp = top?.[0];
  const moov = top?.find((x) => x.type === 'moov');
  if (!top || !ftyp || !moov) return null;
  const b = input.slice();
  let hasVideo = false;
  let hasAudio = false;
  let durationMs = 0;

  const blank = (box: Box) => {
    b.fill(0, box.body, box.end);
    b.set([0x66, 0x72, 0x65, 0x65], box.start + 4); // 'free'
  };

  const walk = (from: number, to: number): boolean => {
    const children = boxes(b, from, to);
    if (!children) return false;
    for (const child of children) {
      if (METADATA.has(child.type)) blank(child);
      else if (CONTAINERS.has(child.type) && !walk(child.body, child.end)) return false;
      else if (child.type === 'mvhd') {
        const v1 = b[child.body] === 1;
        const timescale = u32(b, child.body + (v1 ? 20 : 12));
        const duration = v1 ? u64(b, child.body + 24) : u32(b, child.body + 16);
        if (timescale > 0) durationMs = Math.round((duration / timescale) * 1000);
      } else if (child.type === 'hdlr') {
        const handler = ascii(b, child.body + 8, 4);
        if (handler === 'vide') hasVideo = true;
        if (handler === 'soun') hasAudio = true;
      }
    }
    return true;
  };
  for (const box of top) if (METADATA.has(box.type)) blank(box);
  if (!walk(moov.body, moov.end)) return null;

  return { brand: ascii(b, ftyp.body, 4), hasVideo, hasAudio, durationMs, bytes: b };
}
