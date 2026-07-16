import type { CollectionArchiveImage, CollectionArchiveManifest, CollectionImportResponse } from '../shared/types';
import {
  CollectionBackupError,
  exportCollectionBackup,
  importCollectionBackup,
  type ImportedImage,
  validateCollectionBackup,
} from './dataTransfer';
import type { Env } from './env';
import { ImageValidationError, storeImage, validateImage } from './images';
import { createZipStream, readStoredZip, type ZipSource, ZipFormatError } from './zip';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export interface CollectionArchiveExport {
  stream: ReadableStream<Uint8Array>;
  cards: number;
  images: number;
}

export async function exportCollectionArchive(env: Env): Promise<CollectionArchiveExport> {
  const [backup, rows] = await Promise.all([
    exportCollectionBackup(env.DB),
    env.DB.prepare(
      `SELECT id, image_key, image_content_type FROM owned_cards
        WHERE image_key IS NOT NULL AND image_content_type IS NOT NULL ORDER BY id`,
    ).all<ImageRow>(),
  ]);
  const available = rows.results.filter((row): row is ValidImageRow => isAllowedType(row.image_content_type));
  const includedCards = new Set(available.map((image) => image.id));
  const images: CollectionArchiveImage[] = available.map((image, index) => ({
    cardId: image.id,
    path: `images/${String(index + 1).padStart(6, '0')}.${extensionFor(image.image_content_type)}`,
    contentType: image.image_content_type,
  }));
  const manifest: CollectionArchiveManifest = {
    ...backup,
    version: 2,
    cards: backup.cards.map((card) => ({ ...card, hadImage: includedCards.has(card.id) })),
    images,
  };
  const sources: ZipSource[] = [
    { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    ...available.map((image, index) => ({
      name: images[index].path,
      data: async () => {
        const object = await env.CARD_IMAGES.get(image.image_key);
        if (!object) throw new CollectionBackupError(`The stored photo for card ${image.id} is missing.`);
        return object.body;
      },
    })),
  ];
  return { stream: createZipStream(sources), cards: backup.cards.length, images: images.length };
}

export async function importCollectionArchive(env: Env, buffer: ArrayBuffer): Promise<CollectionImportResponse> {
  let files: Map<string, Uint8Array>;
  try {
    files = readStoredZip(buffer, MAX_ARCHIVE_BYTES);
  } catch (error) {
    if (error instanceof ZipFormatError) throw new CollectionBackupError(error.message);
    throw error;
  }
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes || manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new CollectionBackupError('The ZIP backup does not contain a valid manifest.json file.');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    throw new CollectionBackupError('The ZIP backup manifest is not valid JSON.');
  }
  const backup = await validateCollectionBackup(env.DB, value);
  if (backup.version !== 2) throw new CollectionBackupError('The ZIP must contain a version 2 Dexfolio manifest.');
  if (files.size !== backup.images.length + 1 || backup.images.some((image) => !files.has(image.path))) {
    throw new CollectionBackupError('The ZIP image files do not match its manifest.');
  }

  const pokemon = await env.DB.prepare('SELECT id, national_dex_number FROM pokemon').all<{
    id: number;
    national_dex_number: number;
  }>();
  const pokemonByNumber = new Map(pokemon.results.map((row) => [row.national_dex_number, row.id]));
  const cardsById = new Map(backup.cards.map((card) => [card.id, card]));
  const importedImages = new Map<string, ImportedImage>();
  const stagedKeys: string[] = [];
  const oldImages = await existingImageKeys(env.DB);
  try {
    for (const image of backup.images) {
      const card = cardsById.get(image.cardId)!;
      const pokemonId = pokemonByNumber.get(card.pokemonNationalDexNumber)!;
      const bytes = files.get(image.path)!;
      let validated;
      try {
        const imageBuffer = bytes.slice().buffer as ArrayBuffer;
        validated = await validateImage(new File([imageBuffer], image.path, { type: image.contentType }));
      } catch (error) {
        if (error instanceof ImageValidationError) {
          throw new CollectionBackupError(`The archived image ${image.path} is invalid: ${error.message}`);
        }
        throw error;
      }
      if (!validated) throw new CollectionBackupError(`The archived image ${image.path} is empty.`);
      const key = await storeImage(env, pokemonId, validated);
      stagedKeys.push(key);
      importedImages.set(image.cardId, { key, contentType: validated.contentType });
    }
    const result = await importCollectionBackup(env.DB, backup, importedImages);
    await deleteImagesQuietly(env.CARD_IMAGES, oldImages, 'superseded');
    return result;
  } catch (error) {
    await deleteImagesQuietly(env.CARD_IMAGES, stagedKeys, 'staged');
    throw error;
  }
}

async function existingImageKeys(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare('SELECT image_key FROM owned_cards WHERE image_key IS NOT NULL')
    .all<{ image_key: string }>();
  return rows.results.map((row) => row.image_key);
}

async function deleteImagesQuietly(bucket: R2Bucket, keys: string[], kind: string) {
  try {
    for (const group of chunk(keys, 1000)) await bucket.delete(group);
  } catch (error) {
    console.error(`Failed to remove ${kind} card photos during collection import`, error);
  }
}

function isAllowedType(value: string): value is (typeof allowedTypes)[number] {
  return allowedTypes.some((type) => type === value);
}

function extensionFor(contentType: (typeof allowedTypes)[number]): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[contentType];
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}

interface ImageRow {
  id: string;
  image_key: string;
  image_content_type: string;
}

interface ValidImageRow extends ImageRow {
  image_content_type: (typeof allowedTypes)[number];
}
