import { expect, it } from 'vitest';
import { can } from '@/modules/auth/permissions';
it.each(['OWNER', 'ADMIN'] as const)('%s tiene todos los permisos', (role) => {
  for (const p of ['sell', 'stock', 'owner'] as const)
    expect(can({ role, stockEnabled: false }, p)).toBe(true);
});
it('vendedor sin stock solo vende', () => {
  expect(can({ role: 'SELLER', stockEnabled: false }, 'sell')).toBe(true);
  expect(can({ role: 'SELLER', stockEnabled: false }, 'stock')).toBe(false);
  expect(can({ role: 'SELLER', stockEnabled: false }, 'owner')).toBe(false);
});
it('habilitar stock no habilita administración', () => {
  expect(can({ role: 'SELLER', stockEnabled: true }, 'stock')).toBe(true);
  expect(can({ role: 'SELLER', stockEnabled: true }, 'owner')).toBe(false);
});
