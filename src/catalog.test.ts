import { describe, expect, it } from 'vitest';
import type { CatalogCard, CatalogSet } from '../shared/types';
import { findCardMatch, findSetByName, searchCatalogCards, searchCatalogSets } from './catalog';

const sets: CatalogSet[] = [
  { id: 'base1', name: 'Base', code: 'BS', releaseDate: '1999/01/09' },
  { id: 'sv1', name: 'Scarlet & Violet', code: 'SVI', releaseDate: '2023/03/31' },
];
const promoSet: CatalogSet = {
  id: 'svp',
  name: 'Scarlet & Violet Black Star Promos',
  code: 'PR-SV',
  releaseDate: '2023/01/01',
};
const cards: CatalogCard[] = [
  {
    id: 'base1-44',
    name: 'Bulbasaur',
    number: '44',
    rarity: 'Common',
    availablePrintings: [],
    suggestedPrinting: null,
    prices: [],
    pricesUpdatedAt: null,
    tcgplayerUrl: null,
  },
  {
    id: 'base1-44-alt',
    name: 'Bulbasaur Alt',
    number: '44',
    rarity: 'Rare',
    availablePrintings: [],
    suggestedPrinting: null,
    prices: [],
    pricesUpdatedAt: null,
    tcgplayerUrl: null,
  },
];

describe('catalog matching', () => {
  it('matches complete set names case-insensitively', () => {
    expect(findSetByName(sets, 'scarlet & violet')).toMatchObject({ id: 'sv1', code: 'SVI' });
    expect(findSetByName(sets, 'Base Set')).toMatchObject({ id: 'base1', code: 'BS' });
    expect(findSetByName(sets, 'SVI')).toMatchObject({ id: 'sv1' });
    expect(findSetByName([...sets, promoSet], 'SVP')).toMatchObject({ id: 'svp', code: 'PR-SV' });
    expect(findSetByName(sets, 'scar')).toBeNull();
  });

  it('uses card name to disambiguate a duplicate number', () => {
    expect(findCardMatch(cards, 'Bulbasaur Alt', '44')).toMatchObject({ rarity: 'Rare' });
    expect(findCardMatch(cards, '', '44')).toBeNull();
  });

  it('does not guess between catalog variants with the same name and number', () => {
    expect(
      findCardMatch(
        [
          { ...cards[0], id: 'normal', availablePrintings: ['Normal'] },
          { ...cards[0], id: 'holo', availablePrintings: ['Holofoil'] },
        ],
        'Bulbasaur',
        '44',
      ),
    ).toBeNull();
  });

  it('provides forgiving visible set and card suggestions', () => {
    expect(
      searchCatalogSets([...sets, { id: 'blk', name: 'Black Bolt', code: 'BLK', releaseDate: null }], 'pitch bla'),
    ).toEqual([{ id: 'blk', name: 'Black Bolt', code: 'BLK', releaseDate: null }]);
    expect(searchCatalogSets([...sets, promoSet], 'SVP')).toEqual([promoSet]);
    expect(searchCatalogCards(cards, 'alt', 'name')).toEqual([cards[1]]);
    expect(searchCatalogCards(cards, '44', 'number')).toHaveLength(2);
  });

  it('searches localized names, accents, and regional set codes', () => {
    const localized: CatalogSet[] = [
      { id: 'SV2a', name: 'ポケモンカード151', code: 'SV2a', releaseDate: null },
      { id: 'sv08.5', name: 'Évolutions Prismatiques', code: 'sv08.5', releaseDate: null },
    ];

    expect(searchCatalogSets(localized, 'ポケモン')).toEqual([localized[0]]);
    expect(searchCatalogSets(localized, 'evolutions')).toEqual([localized[1]]);
    expect(findSetByName(localized, 'SV2a')).toEqual(localized[0]);
  });
});
