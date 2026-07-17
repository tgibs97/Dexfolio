import type { CatalogCard, CatalogSet } from '../shared/types';

/**
 * Match a complete catalog name or set code. A trailing word "Set" is ignored
 * because collectors commonly say "Base Set" while the catalog calls it "Base".
 */
export function findSetByName(sets: CatalogSet[], name: string): CatalogSet | null {
  const normalized = normalizeSetName(name);
  const identifier = name.trim().toLocaleLowerCase();
  return (
    sets.find(
      (set) =>
        normalizeSetName(set.name) === normalized ||
        set.code.trim().toLocaleLowerCase() === identifier ||
        set.id.trim().toLocaleLowerCase() === identifier,
    ) ?? null
  );
}

function normalizeSetName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[™®]/g, '')
    .replace(/\s+set$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolve a catalog card from the values a user has entered. Number is the most
 * precise identifier inside a set; card name breaks ties for unusual reprints.
 */
export function findCardMatch(cards: CatalogCard[], cardName: string, cardNumber: string): CatalogCard | null {
  const normalizedNumber = cardNumber.trim().toLocaleLowerCase();
  const normalizedName = cardName.trim().toLocaleLowerCase();
  if (normalizedNumber) {
    const numberMatches = cards.filter((card) => card.number.toLocaleLowerCase() === normalizedNumber);
    if (numberMatches.length === 1) return numberMatches[0];
    const namedNumberMatch = numberMatches.find((card) => card.name.toLocaleLowerCase() === normalizedName);
    if (namedNumberMatch) return namedNumberMatch;
  }
  if (normalizedName) {
    const nameMatches = cards.filter((card) => card.name.toLocaleLowerCase() === normalizedName);
    if (nameMatches.length === 1) return nameMatches[0];
  }
  return null;
}

/** Rank set suggestions, allowing any useful token to recover from a typo. */
export function searchCatalogSets(sets: CatalogSet[], query: string, limit = 8): CatalogSet[] {
  const normalizedQuery = normalizeSetName(query);
  if (!normalizedQuery) return sets.slice(0, limit);
  const tokens = normalizedQuery.split(' ').filter((token) => token.length >= 2);

  return sets
    .map((set) => {
      const name = normalizeSetName(set.name);
      const code = set.code.toLocaleLowerCase();
      const id = set.id.toLocaleLowerCase();
      let score = Number.POSITIVE_INFINITY;
      if (name.startsWith(normalizedQuery)) score = 0;
      else if (name.includes(normalizedQuery)) score = 1;
      else if (code.startsWith(normalizedQuery) || id.startsWith(normalizedQuery)) score = 2;
      else if (tokens.length && tokens.every((token) => name.includes(token))) score = 3;
      else if (tokens.some((token) => name.includes(token))) score = 4;
      return { set, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map(({ set }) => set);
}

/** Filter the already Pokémon-specific card results for a visible menu. */
export function searchCatalogCards(
  cards: CatalogCard[],
  query: string,
  field: 'name' | 'number',
  limit = 8,
): CatalogCard[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return cards.slice(0, limit);
  return cards
    .filter((card) => card[field].toLocaleLowerCase().includes(normalized))
    .sort((left, right) => {
      const leftStarts = left[field].toLocaleLowerCase().startsWith(normalized) ? 0 : 1;
      const rightStarts = right[field].toLocaleLowerCase().startsWith(normalized) ? 0 : 1;
      return leftStarts - rightStarts;
    })
    .slice(0, limit);
}
