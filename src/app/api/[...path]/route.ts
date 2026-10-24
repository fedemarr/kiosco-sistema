import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { api } from '@/lib/api';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { transaction } from '@/lib/transaction';
import { can, requirePermission } from '@/modules/auth/permissions';
import { destroySession } from '@/modules/auth/session';
import {
  adjustStock,
  listProducts,
  mergeProducts,
  saveProduct,
  cents,
} from '@/modules/stock/service';
import { checkout, quote, voidOperation } from '@/modules/sales/service';
import { currentShift, openShift, closeShift } from '@/modules/shifts/service';
import { listUsers, createUser, updateUser, passwordSchema } from '@/modules/users/service';
import { report } from '@/modules/reports/service';
import { syncCheckout } from '@/modules/offline/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function dispatch(request: Request, context: Context) {
  const { path } = await context.params;
  return api('sell', async (req, user) => {
    const key = path.join('/');
    const method = req.method;
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    if (method === 'GET' && key === 'auth/me') return user;
    if (method === 'POST' && key === 'auth/logout') {
      await destroySession();
      return { loggedOut: true };
    }
    if (method === 'POST' && key === 'auth/password') {
      const input = z
        .object({ current: z.string().max(100), password: passwordSchema })
        .strict()
        .parse(await req.json());
      const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await bcrypt.compare(input.current, current.passwordHash)))
        throw new AppError('La contraseña actual no es correcta.');
      const passwordHash = await bcrypt.hash(input.password, 12);
      await transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash, mustChangePassword: false },
        });
        await tx.session.deleteMany({ where: { userId: user.id } });
        await audit(tx, user.id, 'PASSWORD_CHANGED', {});
      });
      await destroySession();
      return { changed: true };
    }
    if (method === 'GET' && key === 'catalog') return listProducts(url, false);
    if (method === 'GET' && key === 'categories')
      return db.category.findMany({ orderBy: { name: 'asc' }, take: 200 });
    if (method === 'POST' && key === 'categories') {
      requirePermission(user, 'owner');
      const { name } = z
        .object({ name: z.string().trim().min(2).max(60) })
        .strict()
        .parse(await req.json());
      return transaction(async (tx) => {
        const category = await tx.category.create({ data: { name } });
        await audit(tx, user.id, 'CATEGORY_CREATED', { id: category.id, name });
        return category;
      });
    }
    if (method === 'GET' && key === 'quick') {
      const all = url.searchParams.get('all') === '1';
      if (all) requirePermission(user, 'owner');
      return db.quickButton.findMany({
        where: all ? {} : { active: true },
        orderBy: { sortOrder: 'asc' },
        take: 100,
      });
    }
    if (method === 'POST' && key === 'quick') {
      requirePermission(user, 'owner');
      const data = z
        .object({
          name: z.string().trim().min(2).max(80),
          emoji: z.string().max(8),
          price: cents,
          sortOrder: z.number().int().min(0).max(100),
          id: z.uuid().optional(),
          active: z.boolean().optional(),
        })
        .strict()
        .parse(await req.json());
      const { id, ...values } = data;
      return transaction(async (tx) => {
        const button = id
          ? await tx.quickButton.update({ where: { id }, data: values })
          : await tx.quickButton.create({ data: values });
        await audit(tx, user.id, 'QUICK_BUTTON_UPDATED', { id: button.id, ...values });
        return button;
      });
    }
    if (method === 'GET' && key === 'shifts/current') return currentShift(user.id);
    if (method === 'POST' && key === 'shifts/open') return openShift(user.id, await req.json());
    if (method === 'POST' && key === 'shifts/close') return closeShift(user.id, await req.json());
    if (method === 'POST' && key === 'sales/quote') return quote(user, await req.json());
    if (method === 'POST' && key === 'sales') return checkout(user, await req.json());
    if (method === 'POST' && key === 'sales/sync') return syncCheckout(user, await req.json());
    if (path[0] === 'offline-conflicts') {
      if (method === 'GET' && path.length === 1) {
        requirePermission(user, 'owner');
        return db.offlineConflict.findMany({
          where: { resolved: false },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 100,
          skip: (page - 1) * 100,
        });
      }
      const key = z.uuid().parse(path[1]);
      if (method === 'GET') {
        const value = await db.offlineConflict.findUnique({ where: { key } });
        if (!value || (value.userId !== user.id && !can(user, 'owner')))
          throw new AppError('No encontramos el cobro pendiente.', 404);
        return { resolved: value.resolved, resolution: value.resolution };
      }
      if (method === 'PATCH') {
        requirePermission(user, 'owner');
        const { resolution } = z
          .object({ resolution: z.string().trim().min(5).max(1000) })
          .strict()
          .parse(await req.json());
        return transaction(async (tx) => {
          const conflict = await tx.offlineConflict.update({
            where: { key },
            data: { resolved: true, resolution, resolvedBy: user.id },
          });
          await audit(tx, user.id, 'OFFLINE_REVIEWED', { key, resolution });
          return conflict;
        });
      }
    }
    if (method === 'POST' && path[0] === 'sales' && path[2] === 'void') {
      requirePermission(user, 'owner');
      const { reason } = z
        .object({ reason: z.string().trim().min(3).max(500) })
        .strict()
        .parse(await req.json());
      return voidOperation(user, z.uuid().parse(path[1]), reason);
    }
    if (path[0] === 'stock-requests') {
      if (method === 'GET') {
        requirePermission(user, 'owner');
        return db.stockRequest.findMany({
          where: { status: 'PENDING' },
          include: { user: { select: { name: true } } },
          take: 100,
        });
      }
      if (method === 'POST' && path.length === 1)
        return transaction(async (tx) => {
          const old = await tx.stockRequest.findFirst({
            where: { userId: user.id, status: 'PENDING' },
          });
          return old || tx.stockRequest.create({ data: { userId: user.id } });
        });
      if (method === 'PATCH') {
        requirePermission(user, 'owner');
        const id = z.uuid().parse(path[1]);
        const { approve } = z
          .object({ approve: z.boolean() })
          .strict()
          .parse(await req.json());
        return transaction(async (tx) => {
          const r = await tx.stockRequest.findUniqueOrThrow({ where: { id } });
          if (r.status !== 'PENDING') throw new AppError('La solicitud ya fue resuelta.', 409);
          await tx.user.update({ where: { id: r.userId }, data: { stockEnabled: approve } });
          await audit(tx, user.id, 'STOCK_ACCESS_DECIDED', {
            requestId: id,
            userId: r.userId,
            approve,
          });
          return tx.stockRequest.update({
            where: { id },
            data: { status: approve ? 'APPROVED' : 'REJECTED' },
          });
        });
      }
    }
    if (path[0] === 'products') {
      requirePermission(user, 'stock');
      if (path.length === 1 && method === 'GET') return listProducts(url, true);
      if (path.length === 1 && method === 'POST') return saveProduct(user.id, await req.json());
      if (path[1] === 'duplicates' && method === 'GET') {
        requirePermission(user, 'owner');
        return db.$queryRaw<
          { name: string; ids: string[]; count: bigint }[]
        >`SELECT lower(trim(name)) as name, array_agg(id::text) as ids, count(*)::int as count FROM products WHERE deleted_at IS NULL GROUP BY lower(trim(name)) HAVING count(*) > 1 ORDER BY count(*) DESC LIMIT 100`;
      }
      if (path[1] === 'merge' && method === 'POST') {
        requirePermission(user, 'owner');
        const { targetId, sourceId } = z
          .object({ targetId: z.uuid(), sourceId: z.uuid() })
          .strict()
          .parse(await req.json());
        return mergeProducts(user.id, targetId, sourceId);
      }
      const id = z.uuid().parse(path[1]);
      if (path.length === 2 && method === 'PATCH')
        return saveProduct(user.id, await req.json(), id);
      if (path.length === 2 && method === 'DELETE')
        return transaction(async (tx) => {
          const product = await tx.product.update({
            where: { id },
            data: { deletedAt: new Date() },
          });
          await audit(tx, user.id, 'PRODUCT_DEACTIVATED', { productId: id });
          return product;
        });
      if (path[2] === 'movements' && method === 'GET')
        return db.stockMovement.findMany({
          where: { productId: id },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          skip: (page - 1) * 50,
        });
      if (path[2] === 'movements' && method === 'POST')
        return adjustStock(user.id, id, await req.json());
    }
    if (path[0] === 'users') {
      requirePermission(user, 'owner');
      if (method === 'GET') return listUsers();
      if (method === 'POST') return createUser(user.id, await req.json());
      if (method === 'PATCH') return updateUser(user.id, z.uuid().parse(path[1]), await req.json());
    }
    if (key === 'reports' && method === 'GET') {
      requirePermission(user, 'owner');
      return report(url);
    }
    if (key === 'audit' && method === 'GET') {
      requirePermission(user, 'owner');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const date = z.iso.datetime({ offset: true });
      return db.auditLog.findMany({
        where: {
          ...(url.searchParams.get('user')
            ? { userId: z.uuid().parse(url.searchParams.get('user')) }
            : {}),
          ...(url.searchParams.get('action')
            ? { action: { contains: url.searchParams.get('action')!.slice(0, 80) } }
            : {}),
          ...(from || to
            ? {
                createdAt: {
                  ...(from ? { gte: new Date(date.parse(from)) } : {}),
                  ...(to ? { lte: new Date(date.parse(to)) } : {}),
                },
              }
            : {}),
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: (page - 1) * 50,
      });
    }
    if (key === 'capabilities' && method === 'GET')
      return { stock: can(user, 'stock'), owner: can(user, 'owner') };
    throw new AppError('Ruta no encontrada.', 404, 'NOT_FOUND');
  })(request, path);
}
export { dispatch as GET, dispatch as POST, dispatch as PATCH, dispatch as DELETE };
