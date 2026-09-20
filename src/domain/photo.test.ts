import { describe, expect, it, vi } from 'vitest';
import {
  dataUrlDecodedBytes,
  DIMENSION_STEPS,
  encodeWithinLimit,
  PHOTO_ERRORS,
  PHOTO_MAX_DATAURL_CHARS,
  PHOTO_MAX_INPUT_BYTES,
  PHOTO_MAX_OUTPUT_BYTES,
  squareCrop,
  validatePhotoFile,
  type PhotoOutputType,
} from './photo';

describe('validatePhotoFile (US-2.5a/b)', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s up to 5 MB', (type) => {
    expect(validatePhotoFile({ type, size: 1000 })).toEqual({ ok: true });
    expect(validatePhotoFile({ type, size: PHOTO_MAX_INPUT_BYTES })).toEqual({ ok: true });
  });

  it.each(['application/pdf', 'image/gif', 'image/svg+xml', 'text/plain', '', 'image/heic'])('rejects %j', (type) => {
    expect(validatePhotoFile({ type, size: 1000 })).toEqual({ ok: false, message: PHOTO_ERRORS.type });
  });

  it('rejects files over 5 MB and empty files', () => {
    expect(validatePhotoFile({ type: 'image/png', size: PHOTO_MAX_INPUT_BYTES + 1 })).toEqual({
      ok: false,
      message: PHOTO_ERRORS.tooLarge,
    });
    expect(validatePhotoFile({ type: 'image/png', size: 0 })).toEqual({ ok: false, message: PHOTO_ERRORS.empty });
  });
});

describe('limits are consistent', () => {
  it('a maximum-size image always fits the data-URL character cap', () => {
    const base64Chars = Math.ceil(PHOTO_MAX_OUTPUT_BYTES / 3) * 4;
    expect('data:image/webp;base64,'.length + base64Chars).toBeLessThanOrEqual(PHOTO_MAX_DATAURL_CHARS);
  });
});

describe('dataUrlDecodedBytes', () => {
  it('computes the decoded size from the base64 payload', () => {
    expect(dataUrlDecodedBytes('data:image/webp;base64,QUJD')).toBe(3); // "ABC"
    expect(dataUrlDecodedBytes('data:image/webp;base64,QUJDRA==')).toBe(4);
    expect(dataUrlDecodedBytes('data:image/webp;base64,QUJDREU=')).toBe(5);
  });
});

describe('squareCrop', () => {
  it('centre-crops the shorter side and never upscales', () => {
    expect(squareCrop(4000, 3000, 512)).toEqual({ sx: 500, sy: 0, side: 3000, out: 512 });
    expect(squareCrop(3000, 4000, 512)).toEqual({ sx: 0, sy: 500, side: 3000, out: 512 });
    expect(squareCrop(300, 200, 512)).toEqual({ sx: 50, sy: 0, side: 200, out: 200 });
  });
});

describe('encodeWithinLimit', () => {
  const blob = (size: number, type: string) => ({ size, type });

  it('returns the first attempt that fits (best quality first)', async () => {
    const encode = vi.fn(async (mime: PhotoOutputType, quality: number) =>
      blob(quality >= 0.8 ? 200_000 : 90_000, mime),
    );
    const result = await encodeWithinLimit(encode);
    expect(result).toMatchObject({ mime: 'image/webp', maxDim: 512 });
    expect(result?.blob.size).toBe(90_000);
    expect(encode.mock.calls.map((c) => c[1])).toEqual([0.8, 0.6]);
  });

  it('never returns an image over the limit', async () => {
    const result = await encodeWithinLimit(async (mime) => blob(PHOTO_MAX_OUTPUT_BYTES + 1, mime));
    expect(result).toBeNull();
  });

  it('accepts exactly the limit', async () => {
    const result = await encodeWithinLimit(async (mime) => blob(PHOTO_MAX_OUTPUT_BYTES, mime));
    expect(result?.blob.size).toBe(PHOTO_MAX_OUTPUT_BYTES);
  });

  it('skips a format the browser cannot encode (returns a different type) and falls back to JPEG', async () => {
    const encode = vi.fn(async (mime: PhotoOutputType) => blob(50_000, mime === 'image/webp' ? 'image/png' : mime));
    const result = await encodeWithinLimit(encode);
    expect(result?.mime).toBe('image/jpeg');
    // WebP was tried once, then skipped
    expect(encode.mock.calls.filter((c) => c[0] === 'image/webp')).toHaveLength(1);
  });

  it('steps the dimension down when quality alone is not enough', async () => {
    const encode = vi.fn(async (mime: PhotoOutputType, _q: number, maxDim: number) =>
      blob(maxDim >= 512 ? 500_000 : 60_000, mime),
    );
    const result = await encodeWithinLimit(encode);
    expect(result?.maxDim).toBe(DIMENSION_STEPS[1]);
  });

  it('a null result (canvas failure) counts as unsupported, never as a fit', async () => {
    expect(await encodeWithinLimit(async () => null)).toBeNull();
  });
});
