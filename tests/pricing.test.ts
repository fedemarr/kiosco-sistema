import { describe, expect, it } from 'vitest';
import { calculateTotals, validatePayments } from '@/modules/sales/pricing';
import { businessDate, money, normalizeUsername } from '@/lib/format';
describe('precios en centavos y horario argentino', () => {
  it('cantidades, centavos y recargos redondean el total sin errores de coma flotante', () => {
    const subtotal = 3333 * 3 + 5 * 2;
    expect(calculateTotals(subtotal, 6500, 'SALE', new Date('2026-10-24T02:00:00Z'))).toMatchObject(
      { subtotal: 10009, adjustment: 1001, total: 11010 },
    );
    expect(
      calculateTotals(subtotal, 6500, 'EMPLOYEE', new Date('2026-10-24T02:00:00Z')).total,
    ).toBe(8007);
  });
  it.each([
    ['2026-10-24T00:59:00Z', 10000],
    ['2026-10-24T01:00:00Z', 11000],
    ['2026-10-24T08:59:00Z', 11000],
    ['2026-10-24T09:00:00Z', 10000],
  ])('%s cobra %s', (date, total) => {
    expect(calculateTotals(10000, 6000, 'SALE', new Date(date)).total).toBe(total);
  });
  it('empleado paga 20% menos y nunca tiene recargo', () => {
    expect(calculateTotals(10005, 5000, 'EMPLOYEE', new Date('2026-10-24T02:00:00Z')).total).toBe(
      8004,
    );
  });
  it('retiro del dueño se valoriza a costo', () => {
    expect(calculateTotals(10000, 6000, 'OWNER').total).toBe(6000);
  });
  it('rechaza mixto que no suma y mixto con tarjeta', () => {
    expect(() =>
      validatePayments(
        10000,
        'SALE',
        [
          { method: 'CASH', amount: 5000 },
          { method: 'MP', amount: 4000 },
        ],
        6000,
      ),
    ).toThrow('sumar exactamente');
    expect(() =>
      validatePayments(
        10000,
        'SALE',
        [
          { method: 'CASH', amount: 5000 },
          { method: 'CARD', amount: 5000 },
        ],
        6000,
      ),
    ).toThrow('efectivo más');
  });
  it('acepta mixto exacto, no acepta efectivo insuficiente', () => {
    expect(() =>
      validatePayments(10000, 'SALE', [
        { method: 'CASH', amount: 0 },
        { method: 'MP', amount: 10000 },
      ]),
    ).not.toThrow();
    expect(() =>
      validatePayments(
        10000,
        'SALE',
        [
          { method: 'CASH', amount: 6000 },
          { method: 'MP', amount: 4000 },
        ],
        7000,
      ),
    ).not.toThrow();
    expect(() =>
      validatePayments(10000, 'SALE', [{ method: 'CASH', amount: 10000 }], 9999),
    ).toThrow('no alcanza');
  });
  it('noche antes de 06 corresponde al día anterior', () => {
    expect(businessDate(new Date('2026-10-24T08:59:00Z'), true)).toBe('2026-10-23');
    expect(businessDate(new Date('2026-10-24T09:00:00Z'), true)).toBe('2026-10-24');
  });
  it('normaliza login y formatea pesos', () => {
    expect(normalizeUsername(' Ju AN ')).toBe('juan');
    expect(money(1270000)).toContain('12.700');
  });
});
