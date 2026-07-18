import { describe, expect, it } from 'vitest';
import { cardSchema, priceToCents } from '../worker/validation';

// These tests keep browser-side expectations aligned with the Worker boundary.
describe('card validation', () => {
  it('rejects malformed required fields and prices', () => {
    const result = cardSchema.safeParse({
      cardName: '',
      setName: '',
      cardNumber: '',
      printing: 'Normal',
      language: 'English',
      condition: 'Near mint',
      purchasePrice: '-4',
    });
    expect(result.success).toBe(false);
  });
  it('stores currency as integer cents', () => expect(priceToCents('12.34')).toBe(1234));

  it('accepts eBay fallback links but rejects lookalike domains', () => {
    const input = {
      cardName: 'Alakazam ex',
      setName: 'Shiny Treasure ex',
      cardNumber: '326',
      printing: 'Holofoil',
      language: 'Japanese',
      condition: 'Near mint',
    };

    expect(cardSchema.safeParse({ ...input, tcgplayerUrl: 'https://www.ebay.com/itm/123456789' }).success).toBe(true);
    expect(cardSchema.safeParse({ ...input, tcgplayerUrl: 'https://ebay.com.example.test/itm/123' }).success).toBe(
      false,
    );
  });
});
