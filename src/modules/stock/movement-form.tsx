'use client';
import { useState } from 'react';
import type { Product } from '@/lib/types';

export function MovementForm({
  product,
  type,
  busy,
  onSubmit,
}: {
  product: Product;
  type: 'RECEIPT' | 'COUNT';
  busy: boolean;
  onSubmit: (quantity: number, note?: string) => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const value = Number(quantity);
  const valid =
    quantity.trim() !== '' &&
    Number.isInteger(value) &&
    value >= (type === 'RECEIPT' ? 1 : 0) &&
    value <= 1000000;
  const next = type === 'RECEIPT' ? product.stock + value : value;
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !valid || (type === 'COUNT' && !acknowledged)) return;
        const data = new FormData(event.currentTarget);
        onSubmit(value, String(data.get('note') || '').trim() || undefined);
      }}
    >
      <strong>{product.name}</strong>
      <p className="muted">Stock consultado: {product.stock}</p>
      <p className="note">
        {type === 'RECEIPT'
          ? 'Sumar mercadería: agregá solamente las unidades que ingresan. El stock que ya tenés se conserva.'
          : 'Conteo físico: escribí el TOTAL que contaste. Reemplaza el saldo; no suma mercadería. Para sumar un ingreso usá Cargar.'}
      </p>
      <label>
        {type === 'RECEIPT' ? 'Cantidad a sumar' : 'Cantidad contada'}
        <input
          name="quantity"
          type="number"
          min={type === 'RECEIPT' ? 1 : 0}
          max="1000000"
          step="1"
          required
          value={quantity}
          onChange={(event) => {
            setQuantity(event.target.value);
            setAcknowledged(false);
          }}
        />
      </label>
      {valid && (
        <div className="note" role="note" aria-label="Resultado del movimiento">
          {type === 'RECEIPT' ? (
            <>
              Se suman <strong>{value} unidades</strong>. Saldo estimado: {product.stock} → {next}.
              Las ventas u otros movimientos posteriores pueden modificarlo.
            </>
          ) : (
            <>
              Se reemplaza{' '}
              <strong>
                {product.stock} por {value} unidades
              </strong>{' '}
              ({value - product.stock >= 0 ? '+' : ''}
              {value - product.stock}).
            </>
          )}
        </div>
      )}
      <label>
        Motivo / remito {type === 'COUNT' ? '(obligatorio para corregir)' : '(opcional)'}
        <input name="note" maxLength={500} required={type === 'COUNT'} />
      </label>
      {type === 'COUNT' && (
        <label className="check" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            required
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          Confirmo que conté el stock físico y quiero reemplazar el saldo, no sumar un ingreso.
        </label>
      )}
      <button className="primary" disabled={busy || !valid || (type === 'COUNT' && !acknowledged)}>
        {busy
          ? 'Guardando…'
          : type === 'RECEIPT'
            ? 'Registrar movimiento'
            : 'Confirmar reemplazo del stock'}
      </button>
    </form>
  );
}
