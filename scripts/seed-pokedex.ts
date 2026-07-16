import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

interface NamedResource {
  name: string;
  url: string;
}
interface ListResponse {
  results: NamedResource[];
}

const TOTAL_POKEMON = 1025;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDirectory = path.join(root, 'tmp');
const seedPath = path.join(tempDirectory, 'pokedex-seed.sql');
const target = process.argv.includes('--remote') ? '--remote' : '--local';

export function generationFor(number: number): number {
  const endings = [151, 251, 386, 493, 649, 721, 809, 905, 1025];
  const generation = endings.findIndex((ending) => number <= ending);
  if (generation < 0) throw new Error(`No generation mapping for Pokédex number ${number}`);
  return generation + 1;
}

export function displayName(identifier: string): string {
  const specialNames: Record<string, string> = {
    farfetchd: "Farfetch'd",
    'mr-mime': 'Mr. Mime',
    'mime-jr': 'Mime Jr.',
    'type-null': 'Type: Null',
    flabebe: 'Flabébé',
    sirfetchd: "Sirfetch'd",
    'mr-rime': 'Mr. Rime',
    'wo-chien': 'Wo-Chien',
    'chien-pao': 'Chien-Pao',
    'ting-lu': 'Ting-Lu',
    'chi-yu': 'Chi-Yu',
  };
  return (
    specialNames[identifier] ??
    identifier
      .split('-')
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join('-')
  );
}

function escapeSql(value: string): string {
  return value.replaceAll("'", "''");
}

async function run(): Promise<void> {
  console.log('Downloading the National Pokédex reference list from PokéAPI…');
  const response = await fetch(`https://pokeapi.co/api/v2/pokemon-species?limit=${TOTAL_POKEMON}&offset=0`);
  if (!response.ok) throw new Error(`PokéAPI returned ${response.status}`);
  const data = (await response.json()) as ListResponse;
  if (data.results.length !== TOTAL_POKEMON)
    throw new Error(`Expected ${TOTAL_POKEMON} species but received ${data.results.length}`);

  const values = data.results.map((species, index) => {
    const number = index + 1;
    const artwork = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${number}.png`;
    return `(${number}, ${number}, '${escapeSql(displayName(species.name))}', ${generationFor(number)}, '${artwork}')`;
  });
  const upserts: string[] = [];
  for (let index = 0; index < values.length; index += 100) {
    upserts.push(
      [
        'INSERT INTO pokemon (id, national_dex_number, name, generation, reference_image_url) VALUES',
        `${values.slice(index, index + 100).join(',\n')}\nON CONFLICT(id) DO UPDATE SET`,
        '  national_dex_number = excluded.national_dex_number,',
        '  name = excluded.name,',
        '  generation = excluded.generation,',
        '  reference_image_url = excluded.reference_image_url;',
      ].join('\n'),
    );
  }
  const sql = [
    'PRAGMA foreign_keys = ON;',
    ...upserts,
    'INSERT OR IGNORE INTO collection_slots (pokemon_id) SELECT id FROM pokemon;',
    '',
  ].join('\n');
  await mkdir(tempDirectory, { recursive: true });
  await writeFile(seedPath, sql, 'utf8');

  console.log(`Applying seed data to the ${target === '--remote' ? 'remote' : 'local'} D1 database…`);
  const wranglerCli = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, 'd1', 'execute', 'DB', target, '--file', seedPath], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
  await rm(seedPath, { force: true });
  if (exitCode !== 0) process.exit(exitCode);
  console.log(`Seeded ${TOTAL_POKEMON} Pokémon.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
