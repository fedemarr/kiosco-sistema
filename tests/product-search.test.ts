import { expect, it } from 'vitest';
import { matchesProduct, searchTokens, escapeLike } from '@/lib/product-search';
const product = { name: 'Galletitas Placer Pera', barcode: '7791234567890' };
it.each(['placer', 'pera', 'pera placer', 'PLACER pera', '  pera   galle  ', '779123'])(
  'encuentra tokens parciales independientes: %s',
  (query) => {
    expect(matchesProduct(product, query)).toBe(true);
  },
);
it('requiere todas las palabras y conserva caracteres literales', () => {
  expect(matchesProduct(product, 'pera chocolate')).toBe(false);
  expect(matchesProduct(product, '%')).toBe(false);
  expect(escapeLike('10%_\\')).toBe('10\\%\\_\\\\');
  expect(searchTokens(' pera pera placer ')).toEqual(['pera', 'placer']);
});
