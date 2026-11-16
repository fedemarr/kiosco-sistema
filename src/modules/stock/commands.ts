'use client';
import { z } from 'zod';
import { openDB } from 'idb';
import { request, ApiError } from '@/lib/client';
const database = () =>
  openDB('kiosco-stock-commands-v1', 1, {
    upgrade(db) {
      db.createObjectStore('stockRequests');
    },
    blocking(_version, _next, event) {
      (event.target as IDBDatabase).close();
    },
  });
const commandSchema = z
  .object({
    productId: z.uuid(),
    productName: z.string(),
    requestKey: z.uuid(),
    type: z.enum(['RECEIPT', 'COUNT']),
    quantity: z.number().int().nonnegative(),
    note: z.string().optional(),
    expectedStock: z.number().int().nonnegative().optional(),
  })
  .strict();
export type StockCommand = z.infer<typeof commandSchema>;
const resultSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  userId: z.uuid(),
  requestKey: z.uuid(),
  type: z.enum(['RECEIPT', 'COUNT']),
  quantity: z.number().int(),
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
});
export type StockResult = z.infer<typeof resultSchema>;
const active = new Map<string, { key: string; promise: Promise<unknown> }>();
export const stockCommandInFlight = (userId: string) => active.has(userId);
const changed = () => window.dispatchEvent(new Event('stock-command-change'));
export async function pendingStockCommand(userId: string): Promise<StockCommand | null> {
  const value = await (await database()).get('stockRequests', userId);
  return value ? commandSchema.parse(value) : null;
}
async function clear(userId: string, key: string) {
  const db = await database();
  const tx = db.transaction('stockRequests', 'readwrite');
  const current = await tx.store.get(userId);
  if (current?.requestKey === key) await tx.store.delete(userId);
  await tx.done;
  changed();
}
export async function performStockCommand(userId: string, input: StockCommand) {
  const command = commandSchema.parse(input);
  const existing = active.get(userId);
  if (existing) {
    if (existing.key === command.requestKey) return existing.promise;
    throw new Error('Hay una carga en curso. Esperá su confirmación.');
  }
  const promise = send(userId, command).finally(() => active.delete(userId));
  active.set(userId, { key: command.requestKey, promise });
  return promise;
}
async function send(userId: string, command: StockCommand) {
  const db = await database();
  const tx = db.transaction('stockRequests', 'readwrite');
  const pending = await tx.store.get(userId);
  if (pending && JSON.stringify(pending) !== JSON.stringify(command)) {
    await tx.done;
    throw new Error(
      'Hay una carga pendiente de confirmación. Usá «Confirmar estado de la carga» antes de iniciar otra.',
    );
  }
  await tx.store.put(command, userId);
  await tx.done;
  changed();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const { productId, productName, ...body } = command;
    void productName;
    const response = await request<unknown>(
      `products/${productId}/movements`,
      'POST',
      {
        ...body,
        expectedUserId: userId,
      },
      { signal: controller.signal },
    );
    const checked = resultSchema.safeParse(response);
    if (
      !checked.success ||
      checked.data.requestKey !== command.requestKey ||
      checked.data.userId !== userId ||
      checked.data.productId !== productId ||
      checked.data.type !== command.type ||
      checked.data.after - checked.data.before !== checked.data.quantity ||
      (command.type === 'RECEIPT'
        ? checked.data.quantity !== command.quantity
        : checked.data.after !== command.quantity)
    )
      throw new ApiError(
        'No se pudo comprobar el ingreso. La solicitud sigue guardada para verificarla sin duplicar unidades.',
        'UNCONFIRMED_STOCK',
      );
    const result = checked.data;
    await clear(userId, command.requestKey);
    window.dispatchEvent(new Event('stock-change'));
    window.dispatchEvent(new CustomEvent('stock-command-confirmed', { detail: result }));
    return result;
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new ApiError(
        'El servidor no devolvió una confirmación válida. La carga sigue guardada y se verificará con la misma solicitud.',
        'UNCONFIRMED_STOCK',
      );
    if (
      error instanceof ApiError &&
      error.status &&
      error.status < 500 &&
      command.type === 'COUNT' &&
      ![401, 403, 429].includes(error.status) &&
      error.code !== 'STOCK_REQUEST_CONFLICT'
    )
      await clear(userId, command.requestKey);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
