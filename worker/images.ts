import type { Env } from './env';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const types = {
  'image/jpeg': {
    extension: 'jpg',
    matches: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  'image/png': {
    extension: 'png',
    matches: (bytes: Uint8Array) =>
      bytes.slice(0, 8).every((byte, i) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i]),
  },
  'image/webp': {
    extension: 'webp',
    matches: (bytes: Uint8Array) =>
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP',
  },
  'image/gif': {
    extension: 'gif',
    matches: (bytes: Uint8Array) => ['GIF87a', 'GIF89a'].includes(new TextDecoder().decode(bytes.slice(0, 6))),
  },
} as const;

export class ImageValidationError extends Error {}

export interface ValidatedImage {
  file: File;
  contentType: keyof typeof types;
  extension: string;
}

export async function validateImage(value: FormDataEntryValue | null): Promise<ValidatedImage | null> {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_IMAGE_BYTES) throw new ImageValidationError('Image must be 8 MB or smaller.');
  if (!(value.type in types)) throw new ImageValidationError('Use a JPEG, PNG, WebP, or GIF image.');
  const contentType = value.type as keyof typeof types;
  const bytes = new Uint8Array(await value.slice(0, 16).arrayBuffer());
  if (!types[contentType].matches(bytes))
    throw new ImageValidationError('The file contents do not match its image type.');
  return { file: value, contentType, extension: types[contentType].extension };
}

export async function storeImage(env: Env, pokemonId: number, image: ValidatedImage): Promise<string> {
  const key = `cards/${pokemonId}/${crypto.randomUUID()}.${image.extension}`;
  await env.CARD_IMAGES.put(key, image.file.stream(), {
    httpMetadata: { contentType: image.contentType, cacheControl: 'private, max-age=31536000, immutable' },
    customMetadata: { originalName: image.file.name.slice(0, 200) },
  });
  return key;
}
