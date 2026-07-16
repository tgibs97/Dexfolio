import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CollectionArchiveManifest, CollectionBackup } from '../shared/types';
import { createZipStream, readStoredZip } from '../worker/zip';

const root = process.cwd();
const sourcePath = path.join(root, 'dexfolio-test-import.json');
const outputPath = path.join(root, 'dexfolio-test-import.zip');
const backup = JSON.parse(await readFile(sourcePath, 'utf8')) as CollectionBackup;
const imageCardId = 'test-bulbasaur-current';
const imagePath = 'images/000001.png';
const png = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);
const manifest: CollectionArchiveManifest = {
  ...backup,
  version: 2,
  cards: backup.cards.map((card) => ({ ...card, hadImage: card.id === imageCardId })),
  images: [{ cardId: imageCardId, path: imagePath, contentType: 'image/png' }],
};
const stream = createZipStream([
  { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
  { name: imagePath, data: png },
]);
const archive = await new Response(stream).arrayBuffer();
await writeFile(outputPath, new Uint8Array(archive));

const files = readStoredZip(archive, 50 * 1024 * 1024);
const restoredManifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as CollectionArchiveManifest;
if (restoredManifest.version !== 2 || restoredManifest.images.length !== 1 || !files.get(imagePath)?.length) {
  throw new Error('Generated ZIP validation failed.');
}
console.log(`Created ${path.basename(outputPath)} (${archive.byteLength} bytes).`);
