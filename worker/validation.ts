import { z } from 'zod';
import { isSupportedMarketplaceUrl } from './marketplace';

const optionalText = (length: number) => z.string().trim().max(length).optional().or(z.literal(''));
const optionalCents = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || /^\d{1,10}$/.test(value), 'Use a valid price snapshot');
const optionalMarketUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal(''))
  .refine((value) => !value || isSupportedMarketplaceUrl(value), 'Use a valid supported marketplace URL');

export const loginSchema = z.object({ password: z.string().min(1).max(256) });

export const cardSchema = z.object({
  cardName: z.string().trim().min(1, 'Card name is required').max(120),
  setName: z.string().trim().min(1, 'Set name is required').max(120),
  setCode: optionalText(24),
  cardNumber: z.string().trim().min(1, 'Card number is required').max(40),
  rarity: optionalText(80),
  printing: z.string().trim().min(1, 'Printing is required').max(80),
  language: z.string().trim().min(1, 'Language is required').max(40),
  condition: z.string().trim().min(1, 'Condition is required').max(40),
  acquisitionDate: z
    .string()
    .optional()
    .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Use a valid acquisition date'),
  purchasePrice: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^\d{1,7}(\.\d{1,2})?$/.test(value), 'Use a valid non-negative price'),
  catalogCardId: optionalText(80),
  marketPriceCents: optionalCents,
  lowPriceCents: optionalCents,
  midPriceCents: optionalCents,
  highPriceCents: optionalCents,
  priceUpdatedAt: optionalText(40),
  tcgplayerUrl: optionalMarketUrl,
  notes: optionalText(4000),
});

export type ParsedCardInput = z.infer<typeof cardSchema>;

export function formDataToCardInput(form: FormData): Record<string, string> {
  const fields = [
    'cardName',
    'setName',
    'setCode',
    'cardNumber',
    'rarity',
    'printing',
    'language',
    'condition',
    'acquisitionDate',
    'purchasePrice',
    'catalogCardId',
    'marketPriceCents',
    'lowPriceCents',
    'midPriceCents',
    'highPriceCents',
    'priceUpdatedAt',
    'tcgplayerUrl',
    'notes',
  ];
  return Object.fromEntries(
    fields.map((field) => [field, typeof form.get(field) === 'string' ? String(form.get(field)) : '']),
  );
}

export function priceToCents(price?: string): number | null {
  if (!price) return null;
  return Math.round(Number(price) * 100);
}

export function snapshotCents(value?: string): number | null {
  return value ? Number(value) : null;
}
