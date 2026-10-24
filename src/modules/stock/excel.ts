import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { transaction } from '@/lib/transaction';
import { audit } from '@/lib/audit';
import { moveStock } from './service';
import { report } from '@/modules/reports/service';
const headers = ['código', 'nombre', 'costo', 'venta', 'stock', 'mínimo', 'categoría'];
export async function exportWorkbook(kind: string, url: URL) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kiosco';
  if (kind === 'products') {
    const sheet = workbook.addWorksheet('Productos');
    sheet.addRow(headers);
    const products = await db.product.findMany({
      where: { deletedAt: null },
      include: { category: true },
      orderBy: { name: 'asc' },
      take: 20000,
    });
    for (const p of products) {
      const row = sheet.addRow([
        p.barcode,
        p.name,
        p.cost / 100,
        p.price / 100,
        p.stock,
        p.minStock,
        p.category.name,
      ]);
      if (p.trackStock && p.stock <= p.minStock)
        row.eachCell((c) => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
        });
    }
    sheet.getColumn(1).numFmt = '@';
    sheet.getColumn(3).numFmt = '#,##0.00';
    sheet.getColumn(4).numFmt = '#,##0.00';
  } else if (kind === 'reports') {
    const data = await report(url);
    if (data.truncated) throw new AppError('Reducí el rango para exportar un reporte completo.');
    const sheet = workbook.addWorksheet('Turnos');
    sheet.addRow([
      'Fecha',
      'Turno',
      'Empleado',
      'Ventas',
      'Efectivo',
      'MP',
      'Tarjeta',
      'Mixto sin desglose',
      'Total',
      'Esperado al cierre',
      'Contado',
      'Diferencia',
      'Estado',
    ]);
    for (const s of data.shifts) {
      const payments = { CASH: 0, MP: 0, CARD: 0 };
      for (const p of s.operations.flatMap((o) => o.payments)) payments[p.method] += p.amount;
      sheet.addRow([
        s.businessDate,
        s.type,
        s.user.name,
        s.operations.filter((o) => o.type === 'SALE').length,
        payments.CASH / 100,
        payments.MP / 100,
        payments.CARD / 100,
        s.operations.reduce((sum, o) => sum + o.unallocatedPayment, 0) / 100,
        s.operations.filter((o) => o.type !== 'OWNER').reduce((sum, o) => sum + o.total, 0) / 100,
        s.expectedCash === null ? null : s.expectedCash / 100,
        s.countedCash === null ? null : s.countedCash / 100,
        s.difference === null ? null : s.difference / 100,
        s.archived ? 'Histórico' : s.closedAt ? 'Cerrado' : 'Abierto',
      ]);
    }
    const summary = workbook.addWorksheet('Resumen');
    summary.addRows([
      ['Concepto', 'Importe ($)'],
      ['Total cobrado', data.total / 100],
      ['Costo', data.cost === null ? 'Sin costos históricos' : data.cost / 100],
      ['Ganancia', data.profit === null ? 'Sin costos históricos' : data.profit / 100],
      ['Mixto histórico sin desglose', data.payments.UNALLOCATED / 100],
      ['Ventas', data.saleCount],
      ['Consumo de empleados', data.employeeTotal / 100],
    ]);
  } else throw new AppError('Exportación no válida.');
  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((c) => {
      c.width = 22;
    });
    sheet.getColumn(2).width = 32;
  }
  return workbook.xlsx.writeBuffer();
}
const excelRow = z.object({
  barcode: z.string().min(1).max(100),
  name: z.string().min(2).max(150),
  cost: z.number().nonnegative().max(1000000),
  price: z.number().positive().max(1000000),
  stock: z.number().int().nonnegative().max(100000000),
  minStock: z.number().int().nonnegative().max(1000000),
  category: z.string().min(1).max(60),
});
export async function importWorkbook(userId: string, buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 2001)
    throw new AppError('El Excel debe contener entre 1 y 2.000 productos.');
  const normalized = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  for (let i = 0; i < headers.length; i++) {
    if (normalized(sheet.getRow(1).getCell(i + 1).text) !== normalized(headers[i]))
      throw new AppError(
        `Columna ${i + 1}: se esperaba «${headers[i]}». Usá un Excel exportado por este sistema.`,
      );
  }
  const rows: z.infer<typeof excelRow>[] = [];
  for (let n = 2; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    if (!row.hasValues) continue;
    const values = row.values as ExcelJS.CellValue[];
    if (values.some((v) => typeof v === 'object' && v !== null))
      throw new AppError(`Fila ${n}: no se admiten fórmulas, vínculos ni celdas enriquecidas.`);
    rows.push(
      excelRow.parse({
        barcode: row.getCell(1).text.trim(),
        name: row.getCell(2).text.trim(),
        cost: Number(row.getCell(3).value),
        price: Number(row.getCell(4).value),
        stock: Number(row.getCell(5).value),
        minStock: Number(row.getCell(6).value),
        category: row.getCell(7).text.trim(),
      }),
    );
  }
  if (new Set(rows.map((r) => r.barcode)).size !== rows.length)
    throw new AppError('El archivo contiene códigos repetidos.');
  // El archivo completo se valida antes de escribir. Cada stock genera su Kardex.
  return transaction(async (tx) => {
    for (const row of rows) {
      const category = await tx.category.upsert({
        where: { name: row.category },
        create: { name: row.category },
        update: {},
      });
      const data = {
        name: row.name,
        cost: Math.round(row.cost * 100),
        price: Math.round(row.price * 100),
        minStock: row.minStock,
        categoryId: category.id,
        deletedAt: null,
        sellable: true,
        reviewNote: null,
      };
      const old = await tx.product.findUnique({ where: { barcode: row.barcode } });
      const p = old
        ? await tx.product.update({ where: { id: old.id }, data })
        : await tx.product.create({ data: { ...data, barcode: row.barcode } });
      if (!old && p.trackStock && row.stock !== p.stock)
        await moveStock(tx, {
          productId: p.id,
          userId,
          type: 'COUNT',
          delta: row.stock - p.stock,
          note: 'Stock inicial de producto nuevo por Excel del dueño',
        });
    }
    await audit(tx, userId, 'EXCEL_IMPORTED', { count: rows.length });
    return { count: rows.length };
  });
}
