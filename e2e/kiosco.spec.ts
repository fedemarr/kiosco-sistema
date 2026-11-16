import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';
import { money, businessDate } from '../src/lib/format';
import { closeShift } from '../src/modules/shifts/service';
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
test.beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
    throw new Error('E2E requiere base de pruebas.');
  // Cada caso es independiente; no heredar cuotas consumidas por otros casos del fixture.
  await db.rateLimit.deleteMany({
    where: {
      key: {
        in: [
          `login-user:${ownerLogin}`,
          `login-user:${sellerLogin}`,
          `user:${ownerId}`,
          `user:${sellerId}`,
        ],
      },
    },
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
test.afterEach(async () => {
  // El turno es global: un fixture fallido no puede bloquear el caso o proyecto siguiente.
  const active = await db.shift.findMany({
    where: { closedAt: null, archived: false, user: { username: { startsWith: 'e2e-' } } },
  });
  for (const shift of active) await closeShift(shift.userId, { shiftId: shift.id, countedCash: 0 });
});

test('relevo de empleados: cierre definitivo, otra pestaña y copia offline sin turno viejo', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  await page.goto('/turnos');
  await page.locator('select[name="type"]').selectOption('NIGHT');
  await page.getByLabel('Efectivo inicial en caja ($)').fill('0');
  await page.getByRole('button', { name: 'Abrir turno', exact: true }).click();
  await expect(page.getByLabel('Continuidad del turno')).toBeVisible();
  const shift = (await (await page.request.get('/api/shifts/current')).json()).data;
  const seller = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  const other = await context.newPage();
  try {
    expect(
      (
        await seller.post('/api/auth/login', { data: { username: sellerLogin, password } })
      ).status(),
    ).toBe(200);
    const denied = await seller.post('/api/shifts/open', {
      data: { type: 'MORNING', openingCash: 0 },
    });
    expect(denied.status()).toBe(409);
    expect((await denied.json()).error.code).toBe('SHIFT_ALREADY_OPEN');
    await other.goto('/caja');
    await expect(other.getByRole('heading', { name: 'Turno Noche', exact: true })).toBeVisible();
    await other.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect
      .poll(() =>
        other.evaluate(async (userId) => {
          const opened = indexedDB.open('kiosco-pos-v1');
          const db = await new Promise<IDBDatabase>((resolve) => {
            opened.onsuccess = () => resolve(opened.result);
          });
          const value = await new Promise<{ shift?: { id: string } }>((resolve) => {
            const read = db.transaction('snapshots').objectStore('snapshots').get(userId);
            read.onsuccess = () => resolve(read.result);
          });
          db.close();
          return value?.shift?.id;
        }, ownerId),
      )
      .toBe(shift.id);
    page.once('dialog', (d) => void d.accept());
    await page.getByLabel('Efectivo contado ($)').fill('0');
    await page.getByRole('button', { name: 'Cerrar turno y ver diferencia', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Turno cerrado', exact: true })).toBeVisible();
    await expect(other.getByRole('heading', { name: 'Turno Noche', exact: true })).toHaveCount(0);
    await expect(
      other.getByText('Abrí tu turno para empezar a cobrar.', { exact: false }),
    ).toBeVisible();
    // Simular una copia vieja escrita tarde por otra pestaña/carga del catálogo.
    await other.evaluate(
      async ({ userId, shift }) => {
        const opened = indexedDB.open('kiosco-pos-v1');
        const db = await new Promise<IDBDatabase>((resolve) => {
          opened.onsuccess = () => resolve(opened.result);
        });
        const tx = db.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        const read = store.get(userId);
        read.onsuccess = () => store.put({ ...read.result, shift }, userId);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { userId: ownerId, shift },
    );
    await context.setOffline(true);
    await other.goto('/offline');
    await expect(
      other.getByText('Abrí tu turno para empezar a cobrar.', { exact: false }),
    ).toBeVisible();
    await expect(other.getByRole('heading', { name: 'Turno Noche', exact: true })).toHaveCount(0);
    await context.setOffline(false);
    const opened = await seller.post('/api/shifts/open', {
      data: { type: 'MORNING', openingCash: 0 },
    });
    expect(opened.status()).toBe(200);
    const next = (await opened.json()).data;
    expect(next.id).not.toBe(shift.id);
    // Un reenvío desde la pestaña del empleado anterior no debe cerrar al siguiente.
    expect(
      (
        await page.request.post('/api/shifts/close', {
          headers: { Origin: baseURL! },
          data: { shiftId: shift.id, countedCash: 0 },
        })
      ).status(),
    ).toBe(200);
    expect((await (await seller.get('/api/shifts/current')).json()).data.id).toBe(next.id);
    expect(
      (
        await seller.post('/api/shifts/close', { data: { shiftId: next.id, countedCash: 0 } })
      ).status(),
    ).toBe(200);
  } finally {
    await context.setOffline(false);
    await other.close();
    await seller.dispose();
  }
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
  expect((await request.get('/api/shifts/status')).status()).toBe(401);
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
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
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
    expect(
      (
        await seller.post('/api/shifts/close', {
          data: {
            shiftId: (
              await db.shift.findFirstOrThrow({
                where: { userId: sellerId, closedAt: null, archived: false },
              })
            ).id,
            countedCash: 0,
          },
        })
      ).status(),
    ).toBe(200);
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
  await expect(page.getByLabel('Buscar producto')).toHaveValue('');
  await expect(page.getByLabel('Buscar producto')).toBeFocused();
  await page.getByLabel('Efectivo recibido ($)', { exact: true }).fill('1');
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
    page.getByText('Movimiento de stock confirmado. Se registró una sola vez.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Carga de stock pendiente de confirmación', { exact: true }),
  ).toHaveCount(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
    startStock + 2,
  );
  expect(
    (
      await page.request.post('/api/shifts/close', {
        headers: { Origin: baseURL! },
        data: {
          shiftId: (
            await db.shift.findFirstOrThrow({
              where: { userId: ownerId, closedAt: null, archived: false },
            })
          ).id,
          countedCash: 0,
        },
      })
    ).status(),
  ).toBe(200);
});

test('pendiente viejo confirmado desaparece y una respuesta tardía no lo vuelve a crear', async ({
  page,
  baseURL,
}) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  const headers = { Origin: baseURL! };
  const shift = (
    await (
      await page.request.post('/api/shifts/open', {
        headers,
        data: { type: 'NIGHT', openingCash: 0 },
      })
    ).json()
  ).data;
  const cart = { type: 'SALE', items: [{ kind: 'product', productId, quantity: 1 }] };
  const q = (await (await page.request.post('/api/sales/quote', { headers, data: cart })).json())
    .data;
  const payload = {
    ...cart,
    shiftId: shift.id,
    idempotencyKey: crypto.randomUUID(),
    quoteToken: q.quoteToken,
    payments: [{ method: 'MP', amount: q.total }],
  };
  const sold = await page.request.post('/api/sales', { headers, data: payload });
  expect(sold.status()).toBe(200);
  const operation = (await sold.json()).data;
  await db.offlineConflict.create({
    data: {
      key: payload.idempotencyKey,
      userId: ownerId,
      payload,
      code: 'INSUFFICIENT_STOCK',
      message: 'Aviso viejo de prueba',
    },
  });
  await page.evaluate(
    async ({ payload, userId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('kiosco-pos-v1', 2);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = db.transaction('sales', 'readwrite');
      tx.objectStore('sales').put({
        key: payload.idempotencyKey,
        userId,
        payload,
        status: 'REVIEW',
        error: 'Aviso viejo de prueba',
        createdAt: new Date().toISOString(),
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      window.dispatchEvent(new Event('queue-change'));
    },
    { payload, userId: ownerId },
  );
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const open = indexedDB.open('kiosco-pos-v1', 2);
            open.onsuccess = () => resolve(open.result);
          });
          const tx = db.transaction('sales');
          const request = tx.objectStore('sales').count();
          const count = await new Promise<number>((resolve) => {
            request.onsuccess = () => resolve(request.result);
          });
          db.close();
          return count;
        }),
      { timeout: 15000 },
    )
    .toBe(0);
  expect(await db.operation.count({ where: { id: operation.id } })).toBe(1);
  await db.offlineConflict.delete({ where: { key: payload.idempotencyKey } });
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    '**/api/sales/sync',
    async (route) => {
      started();
      await gate;
      await route.fulfill({
        status: 409,
        json: {
          success: false,
          error: { code: 'INSUFFICIENT_STOCK', message: 'Rechazo tardío de prueba' },
        },
      });
    },
    { times: 1 },
  );
  const late = { ...payload, idempotencyKey: crypto.randomUUID() };
  await page.evaluate(
    async ({ payload, userId }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const open = indexedDB.open('kiosco-pos-v1', 2);
        open.onsuccess = () => resolve(open.result);
      });
      const tx = db.transaction('sales', 'readwrite');
      tx.objectStore('sales').put({
        key: payload.idempotencyKey,
        userId,
        payload,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
      window.dispatchEvent(new Event('queue-change'));
    },
    { payload: late, userId: ownerId },
  );
  await received;
  await page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const open = indexedDB.open('kiosco-pos-v1', 2);
      open.onsuccess = () => resolve(open.result);
    });
    const tx = db.transaction('sales', 'readwrite');
    tx.objectStore('sales').delete(key);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, late.idempotencyKey);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/sales/sync'));
  release();
  await response;
  await expect(page.getByText('Ver cobros pendientes', { exact: true })).toHaveCount(0);
  expect(
    (
      await page.request.post('/api/shifts/close', {
        headers,
        data: {
          shiftId: (
            await db.shift.findFirstOrThrow({
              where: { userId: ownerId, closedAt: null, archived: false },
            })
          ).id,
          countedCash: 0,
        },
      })
    ).status(),
  ).toBe(200);
});
test('turno y ventas confirmadas se recuperan en otro equipo aunque venza la sesión anterior', async ({
  page,
  playwright,
  baseURL,
}, testInfo) => {
  const username = `recovery-${crypto.randomUUID().slice(0, 8)}`;
  const user = await db.user.create({
    data: {
      name: 'Vendedor recuperado',
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'SELLER',
    },
  });
  const firstDevice = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  try {
    expect(
      (await firstDevice.post('/api/auth/login', { data: { username, password } })).status(),
    ).toBe(200);
    const opened = await firstDevice.post('/api/shifts/open', {
      data: { type: 'NIGHT', openingCash: 50000 },
    });
    expect(opened.status()).toBe(200);
    const shift = (await opened.json()).data;
    const cart = { type: 'SALE', items: [{ kind: 'product', productId, quantity: 1 }] };
    const q = (await (await firstDevice.post('/api/sales/quote', { data: cart })).json()).data;
    const firstSale = await firstDevice.post('/api/sales', {
      data: {
        ...cart,
        shiftId: shift.id,
        idempotencyKey: crypto.randomUUID(),
        quoteToken: q.quoteToken,
        payments: [{ method: 'CASH', amount: q.total }],
        received: q.total,
      },
    });
    expect(firstSale.status()).toBe(200);
    const sale = (await firstSale.json()).data;
    const stockAfterSale = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
    // Simular equipo perdido: descartar contexto y vencer su sesión, sin cerrar caja.
    await firstDevice.dispose();
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await page.goto('/login');
    await page.getByLabel('Usuario', { exact: true }).fill(username);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
    await expect(page.getByRole('heading', { name: 'Turno Noche', exact: true })).toBeVisible();
    const current = (await (await page.request.get('/api/shifts/current')).json()).data;
    expect(current).toMatchObject({
      id: shift.id,
      closedAt: null,
      openingCash: 50000,
      saleCount: 1,
      saleTotal: q.total,
      totals: { CASH: q.total, MP: 0, CARD: 0 },
    });
    expect(current.operations.map((o: { id: string }) => o.id)).toContain(sale.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
      stockAfterSale,
    );
    if (testInfo.project.name === 'mobile') await page.locator('.pos-turn-heading').click();
    await expect(page.locator('.pos-sale')).toHaveCount(1);
    await page.locator('.pos-sale summary').click();
    await expect(page.locator('.pos-sale')).toContainText(money(q.total));
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/shifts/open', {
          headers,
          data: { type: 'MORNING', openingCash: 0 },
        })
      ).status(),
    ).toBe(409);
    const q2 = (await (await page.request.post('/api/sales/quote', { headers, data: cart })).json())
      .data;
    expect(
      (
        await page.request.post('/api/sales', {
          headers,
          data: {
            ...cart,
            shiftId: shift.id,
            idempotencyKey: crypto.randomUUID(),
            quoteToken: q2.quoteToken,
            payments: [{ method: 'MP', amount: q2.total }],
          },
        })
      ).status(),
    ).toBe(200);
    const continued = (await (await page.request.get('/api/shifts/current')).json()).data;
    expect(continued).toMatchObject({
      id: shift.id,
      saleCount: 2,
      saleTotal: q.total + q2.total,
      closedAt: null,
    });
    await page.goto('/turnos');
    await expect(page.getByLabel('Continuidad del turno')).toContainText('mismo usuario');
    expect(
      (
        await page.request.post('/api/shifts/close', {
          headers,
          data: { shiftId: shift.id, countedCash: 50000 + q.total },
        })
      ).status(),
    ).toBe(200);
    expect((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).difference).toBe(0);
  } finally {
    await firstDevice.dispose();
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
  }
});
test('Stock recupera ingresos sin respuesta valida y verifica el comprobante antes de confirmar', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  await page.goto('/stock');
  const search = page.getByLabel('Buscar en stock');
  await search.fill(barcode);
  await search.press('Enter');
  await expect(search).toHaveValue('');
  const card = page.locator('article').filter({ hasText: barcode });
  const before = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
  let key = '';
  await page.route(
    `**/api/products/${productId}/movements`,
    async (route) => {
      key = route.request().postDataJSON().requestKey;
      await route.fulfill({
        status: 503,
        contentType: 'text/html',
        body: '<html>Unavailable</html>',
      });
    },
    { times: 1 },
  );
  await card.getByRole('button', { name: '+ Cargar', exact: true }).click();
  await page.getByLabel('Cantidad a sumar').fill('7');
  await expect(page.getByLabel('Resultado del movimiento')).toContainText('Se suman 7 unidades');
  await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(page.locator('dialog [role="alert"]')).toContainText('confirmación válida');
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(before);
  await page.reload();
  await expect(
    page.getByText('Movimiento de stock confirmado. Se registró una sola vez.', { exact: true }),
  ).toBeVisible();
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(before + 7);
  expect(await db.stockMovement.count({ where: { requestKey: key } })).toBe(1);
  await search.fill(barcode);
  await search.press('Enter');
  await expect(search).toHaveValue('');
  await page.route(
    `**/api/products/${productId}/movements`,
    async (route) => {
      key = route.request().postDataJSON().requestKey;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const result = await response.json();
      result.data.requestKey = crypto.randomUUID();
      await route.fulfill({ response, json: result });
    },
    { times: 1 },
  );
  await card.getByRole('button', { name: '+ Cargar', exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByLabel('Cantidad a sumar').fill('4');
  await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(page.locator('dialog [role="alert"]')).toContainText('No se pudo comprobar');
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
    before + 11,
  );
  await page.reload();
  await expect(
    page.getByText('Movimiento de stock confirmado. Se registró una sola vez.', { exact: true }),
  ).toBeVisible();
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
    before + 11,
  );
  expect(await db.stockMovement.count({ where: { requestKey: key } })).toBe(1);
  await page.clock.install();
  await search.fill(barcode);
  await search.press('Enter');
  await expect(search).toHaveValue('');
  let release = () => {};
  let captured = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route(
    `**/api/products/${productId}/movements`,
    async (route) => {
      key = route.request().postDataJSON().requestKey;
      captured();
      await gate;
      await route.abort('failed').catch(() => {});
    },
    { times: 1 },
  );
  try {
    await card.getByRole('button', { name: '+ Cargar', exact: true }).click();
    await page.getByLabel('Cantidad a sumar').fill('3');
    await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
    await started;
    await page.clock.fastForward(30001);
    await expect(page.locator('dialog [role="alert"]')).toContainText('Sin conexión');
    expect(await db.stockMovement.count({ where: { requestKey: key } })).toBe(0);
    release();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(
      page.getByText('Movimiento de stock confirmado. Se registró una sola vez.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
      before + 14,
    );
    expect(await db.stockMovement.count({ where: { requestKey: key } })).toBe(1);
  } finally {
    release();
  }
});

test('Stock exige confirmar el reemplazo por conteo y no reintenta conteos automaticamente', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  await page.goto('/stock');
  const search = page.getByLabel('Buscar en stock');
  await search.fill(barcode);
  await search.press('Enter');
  await expect(search).toHaveValue('');
  const card = page.locator('article').filter({ hasText: barcode });
  const before = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
  const target = Math.max(0, before - 1);
  await card.getByRole('button', { name: 'Corregir', exact: true }).click();
  await page.getByLabel('Cantidad contada').fill(String(target));
  await expect(page.getByLabel('Resultado del movimiento')).toContainText(
    `Se reemplaza ${before} por ${target}`,
  );
  const save = page.getByRole('button', { name: 'Confirmar reemplazo del stock', exact: true });
  await expect(save).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: `.screenshots/stock-conteo-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel('Cantidad contada').press('Enter');
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(before);
  await page.getByLabel('Motivo / remito', { exact: false }).fill('Conteo físico de prueba');
  await page
    .getByRole('checkbox', { name: 'Confirmo que conté el stock físico', exact: false })
    .check();
  let key = '';
  await page.route(
    `**/api/products/${productId}/movements`,
    async (route) => {
      key = route.request().postDataJSON().requestKey;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'INTERNAL', message: 'No se confirmó el conteo de prueba' },
        }),
      });
    },
    { times: 1 },
  );
  await save.click();
  await expect(page.locator('dialog [role="alert"]')).toContainText('No se confirmó');
  await page.reload();
  await expect(page.getByText(`Conteo: ${target} unidades`, { exact: false })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirmar estado de la carga', exact: true }),
  ).toBeEnabled();
  expect(await db.stockMovement.count({ where: { requestKey: key } })).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(before);
  await page.getByRole('button', { name: 'Confirmar estado de la carga', exact: true }).click();
  await expect(
    page.getByText('Movimiento de stock confirmado. Se registró una sola vez.', { exact: true }),
  ).toBeVisible();
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(target);
  expect(await db.stockMovement.count({ where: { requestKey: key } })).toBe(1);
});

test('Stock conserva pendientes de versiones anteriores para revision sin aplicarlos automaticamente', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const key = crypto.randomUUID();
  await page.evaluate(
    async ({ userId, product, key }) => {
      const open = indexedDB.open('kiosco-stock-commands-v1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('stockRequests');
      const db = await new Promise<IDBDatabase>((resolve) => {
        open.onsuccess = () => resolve(open.result);
      });
      const tx = db.transaction('stockRequests', 'readwrite');
      tx.objectStore('stockRequests').put(
        {
          productId: product.id,
          productName: product.name,
          requestKey: key,
          type: 'RECEIPT',
          quantity: 2,
        },
        userId,
      );
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { userId: ownerId, product: { id: product.id, name: product.name }, key },
  );
  await page.reload();
  await expect(
    page.getByText('Esta carga quedó pendiente en una versión anterior.', { exact: false }),
  ).toBeVisible();
  expect(await db.stockMovement.count({ where: { requestKey: key } })).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
    product.stock,
  );
  await page.getByRole('button', { name: 'Confirmar estado de la carga', exact: true }).click();
  await expect(
    page.getByText('Movimiento de stock confirmado. Se registró una sola vez.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Carga de stock pendiente de confirmación', { exact: true }),
  ).toHaveCount(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
    product.stock + 2,
  );
  expect(await db.stockMovement.count({ where: { requestKey: key } })).toBe(1);
});

test('Stock descarta respuestas viejas despues de una carga confirmada y conserva el saldo al recargar', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  await page.goto('/stock');
  const input = page.getByLabel('Buscar en stock');
  await input.fill(barcode);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  const card = page.locator('article').filter({ hasText: barcode });
  const before = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
  await expect(card.locator('.pill')).toContainText(`${before} en stock`);
  let release = () => {};
  let captured = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let held = false;
  await page.route('**/api/products?**', async (route) => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await card.getByRole('button', { name: '+ Cargar', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('stock-change')));
    await ready;
    await page.getByLabel('Cantidad a sumar').fill('5');
    await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Movimiento registrado');
    release();
    await expect(card.locator('.pill')).toContainText(`${before + 5} en stock`);
    await page.unrouteAll({ behavior: 'wait' });
    await page.reload();
    await input.fill(barcode);
    await input.press('Enter');
    await expect(card.locator('.pill')).toContainText(`${before + 5} en stock`);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
      before + 5,
    );
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('Stock limpia el buscador al encontrar, conserva el resultado y respeta el siguiente escaneo', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  const first = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const second = await db.product.create({
    data: {
      name: `Otro producto ${crypto.randomUUID()}`,
      barcode: `OTRO-${crypto.randomUUID()}`,
      categoryId: first.categoryId,
      price: 10000,
      cost: 5000,
      trackStock: false,
    },
  });
  await page.goto('/stock');
  const input = page.getByLabel('Buscar en stock');
  await input.fill(barcode);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText(first.name);
  await input.fill(second.barcode);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText(second.name);
  await page.route(`**/api/products?q=${barcode}&page=1`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  const response = page.waitForResponse((r) => new URL(r.url()).searchParams.get('q') === barcode);
  await input.fill(barcode);
  await input.press('Enter');
  await input.fill('Nueva búsqueda');
  await response;
  await expect(input).toHaveValue('Nueva búsqueda');
  await page.unrouteAll({ behavior: 'wait' });
  await input.fill(`INEXISTENTE-${crypto.randomUUID()}`);
  const unknown = await input.inputValue();
  await input.press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: 'No encontramos el producto' }),
  ).toBeVisible();
  await expect(input).toHaveValue(unknown);
});
test('búsqueda flexible, ingresos confirmados, cobro justo y detalle del turno', async ({
  page,
  baseURL,
}, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill(ownerLogin);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al kiosco' }).click();
  await expect(page.getByLabel('Buscar producto')).toBeVisible();
  const origin = { Origin: baseURL! };
  const category = (await db.product.findUniqueOrThrow({ where: { id: productId } })).categoryId;
  const tag = crypto.randomUUID().slice(0, 8);
  const name = `Galletitas Placer Pera ${tag}`;
  const saved = await page.request.post('/api/products', {
    headers: origin,
    data: {
      name,
      barcode: `PERA-${tag}`,
      categoryId: category,
      price: 10000,
      cost: 5000,
      minStock: 0,
      trackStock: true,
    },
  });
  expect(saved.status()).toBe(200);
  const p = (await saved.json()).data;
  expect(
    (
      await page.request.post(`/api/products/${p.id}/movements`, {
        headers: origin,
        data: { type: 'RECEIPT', quantity: 3, requestKey: crypto.randomUUID() },
      })
    ).status(),
  ).toBe(200);
  await page.goto('/stock');
  await page.getByLabel('Buscar en stock').fill(`pera placer ${tag}`);
  const card = page.locator('article').filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '+ Cargar', exact: true }).click();
  await page.getByLabel('Cantidad a sumar', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  const receipts = page.getByRole('region', { name: 'Ingresos recientes de stock', exact: true });
  await expect(receipts.getByRole('row').filter({ hasText: name })).toHaveCount(2);
  await page.reload();
  await expect(receipts.getByRole('row').filter({ hasText: name })).toHaveCount(2);
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  expect(
    (
      await page.request.post('/api/shifts/open', {
        headers: origin,
        data: { type: 'NIGHT', openingCash: 0 },
      })
    ).status(),
  ).toBe(200);
  await page.goto('/caja');
  await page.getByLabel('Buscar producto').fill(`pera placer ${tag}`);
  await page.getByRole('button').filter({ hasText: name }).click();
  const charge = page.getByRole('button', { name: 'Confirmar cobro' });
  await expect(charge).toBeEnabled();
  await expect(charge).toContainText('Cobrar justo');
  const posted = page.waitForRequest(
    (r) => new URL(r.url()).pathname === '/api/sales' && r.method() === 'POST',
  );
  await charge.click();
  const payload = (await posted).postDataJSON();
  expect(payload.received).toBe(payload.payments[0].amount);
  await expect(page.getByRole('status')).toContainText('Cobro registrado');
  const shift = (await (await page.request.get('/api/shifts/current')).json()).data;
  expect(shift.saleCount).toBe(1);
  expect(shift.saleTotal).toBe(payload.received);
  if (testInfo.project.name === 'mobile') await page.locator('.pos-turn-heading').click();
  await page.locator('.pos-sale summary').first().click();
  await expect(page.locator('.pos-sale').first().getByLabel('Detalle de venta')).toContainText(
    name,
  );
  await expect(page.getByLabel('Totales del turno')).toContainText(money(payload.received));
  await page.screenshot({ path: `.screenshots/detalle-turno-${testInfo.project.name}.png` });
  if (testInfo.project.name === 'mobile') await page.locator('.pos-turn-heading').click();
  await page.getByLabel('Buscar producto').fill(`pera placer ${tag}`);
  await page.getByRole('button').filter({ hasText: name }).click();
  for (let i = 0; i < 4; i++)
    await page.getByRole('button', { name: `Sumar ${name}`, exact: true }).click();
  await page.getByRole('radio', { name: 'Mercado Pago', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Caja', exact: true }).getByRole('alert'),
  ).toContainText('pedís 5, quedan 4');
  await expect(charge).toBeDisabled();
  await page.getByRole('radio', { name: 'Efectivo', exact: true }).click();
  await expect(charge).toBeDisabled();
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4);
  await page.goto('/reportes');
  const range = page.getByRole('form', { name: 'Rango de fechas', exact: true });
  const start = new Date(
    new Date(businessDate(new Date(), true) + 'T12:00:00Z').getTime() - 7 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  await range.getByLabel('Desde', { exact: true }).fill(start);
  await range.getByLabel('Hasta', { exact: true }).fill(businessDate(new Date(), true));
  await range.getByRole('button', { name: 'Aplicar rango' }).click();
  await expect(page.getByText('Período:', { exact: false })).toContainText(
    start.split('-').reverse().join('/'),
  );
  const shiftRow = page.locator('.shift-report-row').filter({ hasText: 'Dueño de prueba' }).first();
  await shiftRow.locator(':scope > summary').click();
  await expect(shiftRow).toContainText(name);
  await shiftRow.getByText('Ver detalle de venta', { exact: true }).first().click();
  await expect(shiftRow.getByLabel('Detalle de venta').first()).toContainText(
    money(payload.received),
  );
  await page
    .getByRole('navigation', { name: 'Panel del dueño', exact: true })
    .getByRole('button', { name: 'Semana', exact: true })
    .click();
  await expect(page.locator('.week-bars > div')).toHaveCount(8);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  expect(
    (
      await page.request.post('/api/shifts/close', {
        headers: origin,
        data: { shiftId: shift.id, countedCash: payload.received },
      })
    ).status(),
  ).toBe(200);
});
