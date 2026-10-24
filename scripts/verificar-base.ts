import 'dotenv/config';
import { db } from '../src/lib/db';
try {
  const [products, users, operations, categories, quick, tables] = await Promise.all([
    db.product.count(),
    db.user.count(),
    db.operation.count(),
    db.category.count(),
    db.quickButton.count(),
    db.$queryRaw<
      { tablename: string; rowsecurity: boolean }[]
    >`SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  ]);
  console.info(
    JSON.stringify(
      { connected: true, products, users, operations, categories, quick, tables },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
