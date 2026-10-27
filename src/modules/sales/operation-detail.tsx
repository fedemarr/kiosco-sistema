import { money } from '@/lib/format';
import { paymentNames, type Operation } from '@/lib/types';
export function OperationDetail({ operation: o }: { operation: Operation }) {
  return (
    <div className="operation-detail" aria-label="Detalle de venta">
      {o.items.map((item, index) => (
        <div className="row between" key={index}>
          <span>
            {item.quantity} × {item.name}
          </span>
          <strong>
            {money(
              o.type === 'OWNER' && item.unitCost !== undefined
                ? item.unitCost * item.quantity
                : item.subtotal,
            )}
          </strong>
        </div>
      ))}
      {!!o.adjustment && (
        <div className="row between">
          <span>{o.adjustment > 0 ? 'Recargo nocturno' : 'Descuento'}</span>
          <strong>{money(o.adjustment)}</strong>
        </div>
      )}
      {o.payments.map((p) => (
        <div className="row between" key={p.method}>
          <span>{paymentNames[p.method]}</span>
          <strong>{money(p.amount)}</strong>
        </div>
      ))}
      {!!o.unallocatedPayment && <p>Mixto histórico sin desglose: {money(o.unallocatedPayment)}</p>}
      <div className="row between">
        <strong>Total</strong>
        <strong>{money(o.total)}</strong>
      </div>
    </div>
  );
}
