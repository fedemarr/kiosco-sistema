import 'dotenv/config';
import { db } from '../src/lib/db';
export async function seed() {
  for (const name of [
    'General',
    'Bebidas',
    'Golosinas',
    'Snacks',
    'Comidas',
    'Galletitas',
    'Artículos varios',
    'Cigarrillos',
    'Limpieza',
    'Servicios',
  ])
    await db.category.upsert({ where: { name }, create: { name }, update: {} });
  for (const [sortOrder, name, emoji, price] of [
    [0, 'Pancho', '🌭', 200000],
    [1, 'Cigarrillo suelto', '🚬', 150000],
    [2, 'Gomitas', '🍬', 50000],
  ] as const)
    await db.quickButton.upsert({
      where: { name },
      create: { name, emoji, price, sortOrder },
      update: {},
    });
}
await seed();
console.info('Categorías y botones preparados. No se importaron productos ni usuarios.');
await db.$disconnect();
