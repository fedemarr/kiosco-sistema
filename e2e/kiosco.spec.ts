import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';
import { money, businessDate } from '../src/lib/format';
const password = `Test-${crypto.randomUUID()}`;
let ownerId: string;
let sellerId: string;
let ownerLogin: string;
let sellerLogin: string;
let sellerName: string;
let productId: string;
let barcode: string;
test.beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
    throw new Error('E2E requiere base de pruebas.');
  const tag = crypto.randomUUID().slice(0, 8);
  ownerLogin = `e2e-owner-${tag}`;
  sellerLogin = `e2e-seller-${tag}`;
  sellerName = `Vendedor de prueba ${tag}`;
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
    data: { name: sellerName, username: sellerLogin, passwordHash, role: 'SELLER' },
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
test('aviso y cobro nocturnos cambian a las 22 y a las 06 de Buenos Aires', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T00:59:58Z') });
  await page.clock.pauseAt(new Date('2026-10-26T00:59:59Z'));
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  const banner = page.getByRole('note', { name: 'Tarifa nocturna', exact: true });
  const charge = page.getByRole('button', { name: 'Confirmar cobro' });
  await page.clock.runFor(200);
  await expect(banner).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect(banner).toContainText('Tarifa nocturna activa — +10% (22:00 a 06:00)');
  await expect(charge).toHaveClass(/pos-charge-night/);
  await page.screenshot({ path: `.screenshots/tarifa-nocturna-${page.viewportSize()!.width}.png` });
  await page.clock.setSystemTime(new Date('2026-10-26T09:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(banner).toHaveCount(0);
  await expect(charge).not.toHaveClass(/pos-charge-night/);
});
test('carrito largo con scroll interno y cobro visible', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  for (let i = 1; i <= 12; i++) {
    await page.getByRole('button', { name: 'Venta rápida', exact: true }).click();
    await page.getByLabel('Descripción', { exact: true }).fill(`Producto de mostrador ${i}`);
    await page.getByLabel('Precio ($)', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Agregar al carrito', exact: true }).click();
  }
  const cart = page.getByRole('region', { name: 'Carrito', exact: true });
  const charge = page.getByRole('button', { name: 'Confirmar cobro' });
  const sizes =
    testInfo.project.name === 'desktop'
      ? [
          { width: 1366, height: 768 },
          { width: 1280, height: 720 },
          { width: 1024, height: 768 },
        ]
      : [{ width: 390, height: 844 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const method of ['Efectivo', 'Mixto', 'Mercado Pago']) {
      await page.getByRole('radio', { name: method, exact: true }).click();
      await expect(page.getByText('Actualizando cotización…', { exact: true })).toHaveCount(0);
      await expect
        .poll(() =>
          cart.evaluate((el) => el.scrollHeight > el.clientHeight && el.clientHeight > 70),
        )
        .toBe(true);
      const initial = await charge.boundingBox();
      expect(initial!.y + initial!.height).toBeLessThanOrEqual(
        size.height - (size.width < 700 ? 65 : 0),
      );
      await cart.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const last = page.getByRole('button', {
        name: 'Sumar Producto de mostrador 12',
        exact: true,
      });
      await expect(last).toBeInViewport();
      await last.click();
      const after = await charge.boundingBox();
      expect(after!.y).toBeCloseTo(initial!.y, 0);
      const target = await last.boundingBox();
      expect(target!.height).toBeGreaterThanOrEqual(44);
      expect(target!.width).toBeGreaterThanOrEqual(44);
      await page
        .getByRole('button', { name: 'Restar Producto de mostrador 12', exact: true })
        .click();
      await expect(page.getByText('Actualizando cotización…', { exact: true })).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }
    await page.screenshot({ path: `.screenshots/carrito-${size.width}x${size.height}.png` });
  }
  await page.getByRole('button', { name: 'Quitar Producto de mostrador 12', exact: true }).click();
  await expect(page.locator('.pos-cart-row')).toHaveCount(11);
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
  // Esta prueba abre un turno de mañana, incluso si se ejecuta de madrugada.
  await page.getByLabel('Fecha de los turnos').fill(businessDate());
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

test('reportes siguen el día operativo a las 06 y conservan una fecha elegida', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-26T08:59:59Z'));
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  await page.goto('/reportes');
  const date = page.getByLabel('Fecha de los turnos');
  await expect(date).toHaveValue('2026-10-25');
  await page.clock.setFixedTime(new Date('2026-10-26T09:00:01Z'));
  await expect(date).toHaveValue('2026-10-26');
  await date.fill('2026-10-24');
  await page.clock.setFixedTime(new Date('2026-10-27T09:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(date).toHaveValue('2026-10-24');
  await page.getByRole('button', { name: 'Ver día actual', exact: true }).click();
  await expect(date).toHaveValue('2026-10-27');
});
test('reportes reciben ventas y anulaciones de otra sesión sin recargar', async ({
  page,
  playwright,
  baseURL,
}) => {
  const seller = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  try {
    expect(
      (
        await seller.post('/api/auth/login', { data: { username: sellerLogin, password } })
      ).status(),
    ).toBe(200);
    const opened = await seller.post('/api/shifts/open', {
      data: { type: 'NIGHT', openingCash: 0 },
    });
    expect(opened.status()).toBe(200);
    const shift = (await opened.json()).data;
    await page.goto('/login');
    await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
    await expect(page.getByLabel('Buscar producto')).toBeVisible();
    await page.goto('/reportes');
    await expect(page.getByLabel('Fecha de los turnos')).toHaveValue(
      businessDate(new Date(), true),
    );
    await page
      .getByRole('navigation', { name: 'Panel del dueño', exact: true })
      .getByRole('button', { name: 'Hoy', exact: true })
      .click();
    const count = page
      .locator('.report-stat')
      .filter({ hasText: /^Ventas/ })
      .locator('strong');
    await expect(count).toBeVisible();
    const before = Number(await count.textContent());
    const cart = { type: 'SALE', items: [{ kind: 'product', productId, quantity: 1 }] };
    const quoted = await seller.post('/api/sales/quote', { data: cart });
    expect(quoted.status()).toBe(200);
    const q = (await quoted.json()).data;
    const sold = await seller.post('/api/sales', {
      data: {
        ...cart,
        shiftId: shift.id,
        idempotencyKey: crypto.randomUUID(),
        quoteToken: q.quoteToken,
        payments: [{ method: 'MP', amount: q.total }],
      },
    });
    expect(sold.status()).toBe(200);
    await expect(count).toHaveText(String(before + 1), { timeout: 10000 });
    await expect(page.locator('.employee-bar').filter({ hasText: sellerName })).toContainText(
      money(q.total),
    );
    const operation = await db.operation.findFirstOrThrow({
      where: { userId: sellerId, shiftId: shift.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(
      (
        await page.request.post(`/api/sales/${operation.id}/void`, {
          headers: { Origin: baseURL! },
          data: { reason: 'Anulacion de prueba de reporte automatico' },
        })
      ).status(),
    ).toBe(200);
    await expect(count).toHaveText(String(before), { timeout: 10000 });
    await expect(page.getByLabel('Estado de actualización de reportes')).toContainText(
      'Última consulta',
    );
    expect((await seller.post('/api/shifts/close', { data: { countedCash: 0 } })).status()).toBe(
      200,
    );
  } finally {
    await seller.dispose();
  }
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
  await expect(page.getByRole('button', { name: 'Confirmar cobro' })).toBeDisabled();
  const quotation = await page.request.post('/api/sales/quote', {
    headers: { Origin: baseURL! },
    data: { type: 'SALE', items: [{ kind: 'product', productId, quantity: 2 }] },
  });
  const quoteData = (await quotation.json()).data;
  await page
    .getByLabel('Efectivo recibido ($)', { exact: true })
    .fill(String((quoteData.total + 50000) / 100));
  await expect(page.locator('.pos-payment-fields')).toContainText('Vuelto');
  await expect(page.locator('.pos-payment-fields')).toContainText(money(50000));
  await expect(page.getByRole('button', { name: 'Confirmar cobro' })).toBeEnabled();
  await page.getByRole('radio', { name: 'Mixto', exact: true }).click();
  await page.getByLabel('Parte en efectivo ($)', { exact: true }).fill('0');
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
