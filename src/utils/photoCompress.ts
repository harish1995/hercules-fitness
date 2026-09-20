import {
  encodeWithinLimit,
  PHOTO_ERRORS,
  squareCrop,
  validatePhotoFile,
  type PhotoOutputType,
} from '../domain/photo';
import { type MemberPhoto } from '../types/member';

/** A photo problem with a message that is safe to show as-is. */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoError';
  }
}

function toBlob(canvas: HTMLCanvasElement, mime: PhotoOutputType, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Validate, decode, centre-crop to a square (max 512 px) and re-encode a chosen image to <= ~100 KB (US-2.5).
 * Re-encoding through a canvas drops ALL EXIF/GPS metadata by construction, so no location data is stored.
 * Throws PhotoError (friendly message) for a wrong type, oversize, corrupt or un-compressible image. Browser-only
 * (canvas): the decisions live in domain/photo.ts and are unit-tested there.
 */
export async function compressPhoto(file: File): Promise<MemberPhoto> {
  const check = validatePhotoFile(file);
  if (!check.ok) throw new PhotoError(check.message);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PhotoError(PHOTO_ERRORS.unreadable);
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoError(PHOTO_ERRORS.unreadable);

    const encoded = await encodeWithinLimit((mime, quality, maxDim) => {
      const { sx, sy, side, out } = squareCrop(bitmap.width, bitmap.height, maxDim);
      canvas.width = out;
      canvas.height = out;
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
      return toBlob(canvas, mime, quality);
    });
    if (!encoded) throw new PhotoError(PHOTO_ERRORS.cannotCompress);

    const { out } = squareCrop(bitmap.width, bitmap.height, encoded.maxDim);
    return {
      dataUrl: await readAsDataUrl(encoded.blob),
      contentType: encoded.mime,
      bytes: encoded.blob.size,
      width: out,
      height: out,
    };
  } finally {
    bitmap.close();
  }
}
