import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';
const password = `Test-${crypto.randomUUID()}`;
let ownerId: string;
let sellerId: string;
let ownerLogin: string;
let sellerLogin: string;
let productId: string;
let barcode: string;
test.beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
    throw new Error('E2E requiere base de pruebas.');
  const tag = crypto.randomUUID().slice(0, 8);
  ownerLogin = `e2e-owner-${tag}`;
  sellerLogin = `e2e-seller-${tag}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const owner = await db.user.create({
    data: {
      name: 'Dueño de prueba',
      username: ownerLogin,
      passwordHash,
      role: 'OWNER',
      stockEnabled: true,
    },
  });
  ownerId = owner.id;
  const seller = await db.user.create({
    data: { name: 'Vendedor de prueba', username: sellerLogin, passwordHash, role: 'SELLER' },
  });
  sellerId = seller.id;
  const c = await db.category.create({ data: { name: `E2E ${tag}` } });
  barcode = `E2E-${tag}`;
  const p = await db.product.create({
    data: {
      name: `Alfajor de prueba ${tag}`,
      barcode,
      categoryId: c.id,
      price: 150000,
      cost: 80000,
      stock: 0,
      minStock: 30,
    },
  });
  productId = p.id;
  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: p.id }, data: { stock: { increment: 20 } } });
    await tx.stockMovement.create({
      data: {
        productId: p.id,
        userId: owner.id,
        type: 'RECEIPT',
        quantity: 20,
        before: 0,
        after: 20,
        note: 'Fixture E2E',
      },
    });
  });
});
test.afterAll(async () => {
  await db.session.deleteMany({ where: { userId: { in: [ownerId, sellerId].filter(Boolean) } } });
  await db.user.updateMany({
    where: { id: { in: [ownerId, sellerId].filter(Boolean) } },
    data: { deletedAt: new Date() },
  });
  await db.$disconnect();
});
test('API privada y permisos actualizados en sesiones abiertas', async ({
  playwright,
  request,
  baseURL,
}) => {
  expect((await request.get('/api/products')).status()).toBe(401);
  expect((await request.get('/api/reports')).status()).toBe(401);
  const owner = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  const seller = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  expect(
    (
      await owner.post('/api/auth/login', {
        data: { username: ownerLogin.toUpperCase(), password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await seller.post('/api/auth/login', { data: { username: sellerLogin, password } })).status(),
  ).toBe(200);
  expect((await seller.get('/api/products')).status()).toBe(403);
  expect((await seller.get('/api/reports')).status()).toBe(403);
  expect(
    (await owner.patch(`/api/users/${sellerId}`, { data: { stockEnabled: true } })).status(),
  ).toBe(200);
  expect((await seller.get('/api/products')).status()).toBe(200);
  expect(
    (await owner.patch(`/api/users/${sellerId}`, { data: { stockEnabled: false } })).status(),
  ).toBe(200);
  expect((await seller.get('/api/products')).status()).toBe(403);
  expect(
    (
      await seller.post('/api/shifts/open', {
        data: { type: 'MORNING', openingCash: 0, userId: ownerId },
      })
    ).status(),
  ).toBe(400);
  await owner.dispose();
  await seller.dispose();
});
test('caja, turno, venta offline idempotente y diseño sin desborde', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  await page.goto('/turnos');
  await page.getByLabel('Efectivo inicial en caja ($)').fill('1000');
  await page.getByRole('button', { name: 'Abrir turno', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mañana', exact: true })).toBeVisible();
  await page.goto('/caja');
  await page.getByLabel('Buscar producto').fill(barcode);
  await page.getByLabel('Buscar producto').press('Enter');
  await expect(page.locator('.pos-cart-row')).toContainText(
    barcode.replace('E2E-', 'Alfajor de prueba '),
  );
  await expect(page.getByRole('radio')).toHaveCount(4);
  await page.getByRole('radio', { name: 'Mercado Pago', exact: true }).click();
  const charge = page.getByRole('button', { name: 'Confirmar cobro' });
  await expect(charge).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: `.screenshots/caja-${testInfo.project.name}.png`, fullPage: true });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(async () => !!(await caches.match('/offline')))).toBe(true);
  await page.context().setOffline(true);
  await charge.click();
  await expect(page.getByRole('status')).toContainText('pendiente');
  await expect(page.getByText('Ver cobros pendientes', { exact: true })).toBeVisible();
  // Se puede armar otro carrito sin una cotización online y reabrir la app sin red.
  await page.getByLabel('Buscar producto').fill(barcode);
  await page.locator('.product-tile').filter({ hasText: 'Alfajor de prueba' }).first().click();
  await expect(charge).toBeEnabled();
  await charge.click();
  await expect(page.getByRole('status')).toContainText('pendiente');
  await page.reload();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  await expect(page.getByText('Ver cobros pendientes', { exact: true })).toBeVisible();
  const restored = page.waitForEvent(
    'framenavigated',
    (frame) => frame === page.mainFrame() && new URL(frame.url()).pathname === '/caja',
  );
  await page.context().setOffline(false);
  await restored;
  await page.waitForLoadState('load');
  await expect
    .poll(
      async () =>
        db.operation.count({ where: { userId: ownerId, items: { some: { productId } } } }),
      { timeout: 20000 },
    )
    .toBe(2);
  await page.goto('/turnos');
  await expect(page.getByText('Mercado Pago', { exact: false }).first()).toBeVisible();
  await page.getByLabel('Efectivo contado ($)').fill('1000');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Cerrar turno y ver diferencia' }).click();
  await expect(page.getByRole('heading', { name: 'Turno cerrado' })).toBeVisible();
  await expect(page.getByText('Diferencia:')).toContainText('$0');
  await page.goto('/stock');
  await expect(page.getByRole('heading', { name: 'Cada producto, en su lugar.' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: `.screenshots/stock-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto('/reportes');
  await expect(page.getByRole('heading', { name: 'Panel del dueño' })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Panel del dueño', exact: true });
  await expect(tabs.getByRole('button')).toHaveCount(6);
  await tabs.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.getByText('Alfajor de prueba', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Distribución por medio de pago' })).toBeVisible();
  await page.screenshot({
    path: `.screenshots/reportes-hoy-${testInfo.project.name}.png`,
    fullPage: true,
  });
  for (const name of ['Semana', 'Empleados', 'Stock']) {
    await tabs.getByRole('button', { name, exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
  const lowRow = page
    .locator('.low-stock-row')
    .filter({ hasText: barcode.replace('E2E-', 'Alfajor de prueba ') });
  await lowRow.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByLabel('Cantidad a sumar').fill('3');
  await page.getByRole('button', { name: 'Registrar ingreso', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Ingreso registrado');
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(21);
  await tabs.getByRole('button', { name: 'Alertas', exact: true }).click();
  await page.getByLabel('Empleado', { exact: true }).selectOption(ownerId);
  await page.getByLabel('Tipo de acción').selectOption('STOCK_ADJUSTED');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.locator('.audit-entry')).toHaveCount(1);
  await expect(page.locator('.audit-entry').first()).toContainText('Unidades: 3');
  await page.screenshot({
    path: `.screenshots/reportes-alertas-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('respuestas perdidas y recargas no duplican una venta ni una carga de mercadería', async ({
  page,
  baseURL,
}) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  const startStock = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
  const startSales = await db.operation.count({
    where: { userId: ownerId, items: { some: { productId } } },
  });
  expect(
    (
      await page.request.post('/api/shifts/open', {
        headers: { Origin: baseURL! },
        data: { type: 'AFTERNOON', openingCash: 0 },
      })
    ).status(),
  ).toBe(200);
  await page.goto('/caja');
  await page.route(`**/api/catalog?q=${encodeURIComponent(barcode)}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.getByLabel('Buscar producto').fill(barcode);
  await page.getByLabel('Buscar producto').press('Enter');
  await page.getByLabel('Buscar producto').fill(barcode);
  await page.getByLabel('Buscar producto').press('Enter');
  await expect(page.locator('.pos-cart-row .quantity span')).toHaveText('2');
  await page.getByRole('radio', { name: 'Mercado Pago', exact: true }).click();
  let saleDelivered!: () => void;
  const lostSale = new Promise<void>((resolve) => {
    saleDelivered = resolve;
  });
  await page.route(
    '**/api/sales',
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
      saleDelivered();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Confirmar cobro' }).click();
  await lostSale;
  await expect
    .poll(() => db.operation.count({ where: { userId: ownerId, items: { some: { productId } } } }))
    .toBe(startSales + 1);
  await page.reload();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('kiosco-pos-v1', 2);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('sales', 'readonly');
              const count = tx.objectStore('sales').count();
              count.onsuccess = () => resolve(count.result);
              count.onerror = () => reject(count.error);
              tx.oncomplete = () => db.close();
            };
          }),
      ),
    )
    .toBe(0);
  await expect(page.getByText('Ver cobros pendientes', { exact: true })).toHaveCount(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
    startStock - 2,
  );
  expect(
    await db.operation.count({ where: { userId: ownerId, items: { some: { productId } } } }),
  ).toBe(startSales + 1);
  await page.goto('/stock');
  await page.getByLabel('Buscar en stock').fill(barcode);
  const row = page.locator('article.card').filter({ hasText: barcode });
  await row.getByRole('button', { name: '+ Cargar', exact: true }).click();
  await page.getByLabel('Cantidad a sumar').fill('4');
  let stockDelivered!: () => void;
  const lostStock = new Promise<void>((resolve) => {
    stockDelivered = resolve;
  });
  await page.route(
    `**/api/products/${productId}/movements`,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
      stockDelivered();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await lostStock;
  await expect
    .poll(async () => (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock)
    .toBe(startStock + 2);
  await page.reload();
  await expect(
    page.getByText('Carga de stock pendiente de confirmación', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar estado de la carga', exact: true }).click();
  await expect(
    page.getByText('Movimiento de stock confirmado. Se registró una sola vez.', { exact: true }),
  ).toBeVisible();
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
    startStock + 2,
  );
  expect(
    (
      await page.request.post('/api/shifts/close', {
        headers: { Origin: baseURL! },
        data: { countedCash: 0 },
      })
    ).status(),
  ).toBe(200);
});
