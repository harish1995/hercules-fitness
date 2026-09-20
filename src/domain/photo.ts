/**
 * Photo pipeline rules (US-2.5, architecture §2.5). The canvas work is in `src/utils/photoCompress.ts`;
 * the decisions (what is accepted, the encoding ladder, the limits) are pure and live here.
 */
export const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PHOTO_MAX_INPUT_BYTES = 5 * 1024 * 1024;
/** Stored image size cap, decoded bytes (also enforced by the Firestore rules). */
export const PHOTO_MAX_OUTPUT_BYTES = 102_400;
/** Data-URL length cap (base64 of 100 KB is ~136.5k chars plus the prefix). Also in the rules. */
export const PHOTO_MAX_DATAURL_CHARS = 180_000;
export const PHOTO_MAX_DIMENSION = 512;

export type PhotoOutputType = 'image/webp' | 'image/jpeg';

export const PHOTO_ERRORS = {
  type: 'Only JPEG, PNG or WebP images can be used as a profile photo.',
  tooLarge: 'This image is larger than 5 MB. Choose a smaller photo.',
  empty: 'This file is empty. Choose a different photo.',
  unreadable: 'This image could not be read. It may be corrupt. Choose a different photo.',
  cannotCompress: 'This image could not be reduced to 100 KB. Try a simpler or smaller photo.',
} as const;

export type PhotoValidation = { ok: true } | { ok: false; message: string };

/** Client-side validation before any decoding: MIME type and size (a PDF, GIF or renamed file is refused). */
export function validatePhotoFile(file: { type: string; size: number }): PhotoValidation {
  if (!(PHOTO_ACCEPTED_TYPES as readonly string[]).includes(file.type)) return { ok: false, message: PHOTO_ERRORS.type };
  if (file.size <= 0) return { ok: false, message: PHOTO_ERRORS.empty };
  if (file.size > PHOTO_MAX_INPUT_BYTES) return { ok: false, message: PHOTO_ERRORS.tooLarge };
  return { ok: true };
}

/** Decoded byte length of the base64 payload of a data URL. */
export function dataUrlDecodedBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Centre square crop ("cover"), never upscaling: output side = min(source side, maxDim). */
export function squareCrop(
  srcWidth: number,
  srcHeight: number,
  maxDim: number = PHOTO_MAX_DIMENSION,
): { sx: number; sy: number; side: number; out: number } {
  const side = Math.min(srcWidth, srcHeight);
  return {
    sx: Math.floor((srcWidth - side) / 2),
    sy: Math.floor((srcHeight - side) / 2),
    side,
    out: Math.max(1, Math.min(side, maxDim)),
  };
}

/** Encoding attempts, best quality first: WebP at falling quality, then JPEG, then smaller dimensions. */
export const ENCODING_LADDER: readonly { mime: PhotoOutputType; quality: number }[] = [
  { mime: 'image/webp', quality: 0.8 },
  { mime: 'image/webp', quality: 0.6 },
  { mime: 'image/webp', quality: 0.45 },
  { mime: 'image/jpeg', quality: 0.7 },
  { mime: 'image/jpeg', quality: 0.5 },
  { mime: 'image/jpeg', quality: 0.35 },
];
export const DIMENSION_STEPS = [PHOTO_MAX_DIMENSION, 384, 256] as const;

export interface EncodedImage {
  size: number;
  type: string;
}

/**
 * Try the ladder until an encoding fits `maxBytes`. `encode` returns the encoded blob (or null) for a
 * (mime, quality, maxDim) attempt. A result whose `type` differs from the requested mime means the browser
 * cannot encode that format (e.g. Safari and WebP): that mime is skipped. Returns null when nothing fits.
 */
export async function encodeWithinLimit<T extends EncodedImage>(
  encode: (mime: PhotoOutputType, quality: number, maxDim: number) => Promise<T | null>,
  maxBytes: number = PHOTO_MAX_OUTPUT_BYTES,
): Promise<{ blob: T; mime: PhotoOutputType; maxDim: number } | null> {
  for (const maxDim of DIMENSION_STEPS) {
    const unsupported = new Set<PhotoOutputType>();
    for (const { mime, quality } of ENCODING_LADDER) {
      if (unsupported.has(mime)) continue;
      const blob = await encode(mime, quality, maxDim);
      if (!blob || blob.type !== mime) {
        unsupported.add(mime);
        continue;
      }
      if (blob.size <= maxBytes) return { blob, mime, maxDim };
    }
  }
  return null;
}
