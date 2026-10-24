'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  UserRound,
  ShoppingBag,
  Banknote,
  CreditCard,
  RefreshCw,
  Moon,
  ChevronDown,
} from 'lucide-react';
import { money, toCents } from '@/lib/format';
import { shiftNames, paymentNames } from '@/lib/types';
import { can } from '@/modules/auth/permissions';
import type { PosModel } from './pos';

const hours = { MORNING: '06–14hs', AFTERNOON: '14–22hs', NIGHT: '22–06hs' };
const methods = [
  { id: 'CASH', name: 'Efectivo', icon: Banknote },
  { id: 'CARD', name: 'Tarjeta', icon: CreditCard },
  { id: 'MP', name: 'Mercado Pago', icon: RefreshCw },
  { id: 'MIXED', name: 'Mixto', icon: Banknote },
];
export function PosScreen({
  model: m,
  inputRef,
}: {
  model: PosModel;
  inputRef: (node: HTMLInputElement | null) => void;
}) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const collected = Object.values(m.shift?.totals || {}).reduce((s, n) => s + n, 0);
  return (
    <div className="pos-layout">
      <section className="pos-workspace" aria-label="Caja">
        <header className="pos-header">
          <div>
            <div className="row">
              <h1>{m.shift ? `Turno ${shiftNames[m.shift.type]}` : 'Caja'}</h1>
              {m.shift && <small>{hours[m.shift.type]}</small>}
            </div>
            <small>{m.user.name}</small>
          </div>
          <div className="pos-actions row">
            {m.type !== 'SALE' && (
              <button disabled={m.busy} onClick={() => m.setType('SALE')}>
                Volver a venta
              </button>
            )}
            <button
              className={m.type === 'EMPLOYEE' ? 'primary' : ''}
              disabled={m.busy}
              onClick={() => m.setType(m.type === 'EMPLOYEE' ? 'SALE' : 'EMPLOYEE')}
            >
              <UserRound size={16} /> Mi consumo
            </button>
            {can(m.user, 'owner') && (
              <button
                className={m.type === 'OWNER' ? 'primary' : ''}
                disabled={m.busy}
                onClick={() => m.setType(m.type === 'OWNER' ? 'SALE' : 'OWNER')}
              >
                <ShoppingBag size={16} /> Retiro
              </button>
            )}
            <Link
              href="/turnos"
              aria-disabled={m.busy}
              onClick={(e) => {
                if (m.busy) e.preventDefault();
              }}
              className={`pos-shift-link ${m.shift ? 'danger' : 'primary'}`}
            >
              {m.shift ? 'Cerrar turno' : 'Abrir turno'}
            </Link>
          </div>
        </header>
        {!m.shift && (
          <p className="note">
            Abrí tu turno para empezar a cobrar.{' '}
            <Link href="/turnos">
              <strong>Abrir turno →</strong>
            </Link>
          </p>
        )}
        {m.message && (
          <p className="success" role="status">
            {m.message}
          </p>
        )}
        {m.error && (
          <p className="error" role="alert">
            {m.error}
          </p>
        )}
        <div className="pos-searchbar">
          <input
            ref={inputRef}
            disabled={m.busy}
            autoFocus
            aria-label="Buscar producto"
            placeholder="Escaneá código o buscá por nombre..."
            value={m.search}
            onChange={(e) => {
              m.setSearch(e.target.value);
              m.setPage(1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void m.scan();
              }
            }}
          />
          <button
            className="primary"
            aria-label="Venta rápida"
            disabled={m.busy}
            aria-expanded={m.custom}
            onClick={() => m.setCustom(!m.custom)}
          >
            <Plus size={21} />
          </button>
        </div>
        {!!m.scanning && <small>Procesando {m.scanning} código(s)…</small>}
        {m.search.trim() && (
          <section className="pos-results card stack" aria-label="Resultados de búsqueda">
            <div className="row between">
              <small>{m.loading ? 'Buscando…' : `${m.totalProducts} productos`}</small>
              <button onClick={() => m.setSearch('')}>Cerrar búsqueda</button>
            </div>
            {m.products.map((p) => (
              <button
                className="product-tile"
                key={p.id}
                disabled={m.busy || (p.trackStock && p.stock <= 0)}
                onClick={() => m.addProduct(p)}
              >
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.barcode} {p.trackStock ? `· Stock ${p.stock}` : ''}
                  </small>
                </span>
                <strong>{money(p.price)}</strong>
              </button>
            ))}
            {!m.loading && !m.products.length && (
              <p className="muted">No encontramos productos. Probá con otro nombre o código.</p>
            )}
            {m.totalProducts > 60 && (
              <div className="row">
                <button disabled={m.page === 1} onClick={() => m.setPage(m.page - 1)}>
                  Anterior
                </button>
                <small>Página {m.page}</small>
                <button
                  disabled={m.page * 60 >= m.totalProducts}
                  onClick={() => m.setPage(m.page + 1)}
                >
                  Siguiente
                </button>
              </div>
            )}
          </section>
        )}
        {m.custom && (
          <section className="card stack pos-quick">
            <div className="row between">
              <h2>Venta rápida</h2>
              <button onClick={() => m.setCustom(false)}>Cerrar</button>
            </div>
            <div className="row">
              {m.quick.map((q) => (
                <button
                  key={q.id}
                  disabled={m.busy}
                  onClick={() =>
                    m.add({ kind: 'quick', key: q.id, quickId: q.id, name: q.name, price: q.price })
                  }
                >
                  {q.emoji} {q.name} · {money(q.price)}
                </button>
              ))}
            </div>
            <form
              className="fields"
              onSubmit={(e) => {
                e.preventDefault();
                if (m.busy) return;
                const d = new FormData(e.currentTarget);
                const price = toCents(String(d.get('price')));
                if (!Number.isInteger(price) || price <= 0) {
                  m.setError('Ingresá un precio válido.');
                  return;
                }
                m.add({
                  kind: 'custom',
                  key: crypto.randomUUID(),
                  name: String(d.get('name')),
                  price,
                });
                m.setCustom(false);
              }}
            >
              <label>
                Descripción
                <input disabled={m.busy} name="name" required minLength={2} maxLength={100} />
              </label>
              <label>
                Precio ($)
                <input
                  disabled={m.busy}
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </label>
              <button disabled={m.busy} className="primary">
                Agregar al carrito
              </button>
            </form>
          </section>
        )}
        <div className="pos-cart" aria-label="Carrito">
          {!m.lines.length && (
            <div className="pos-cart-empty">
              <ShoppingCart size={46} strokeWidth={1.4} />
              <p>Escaneá un producto para empezar</p>
            </div>
          )}
          {m.lines.map((l) => (
            <div className="pos-cart-row" key={l.key}>
              <div>
                <strong>{l.name}</strong>
                <small>{money(l.price)} por unidad</small>
              </div>
              <div className="quantity row">
                <button
                  aria-label={`Restar ${l.name}`}
                  disabled={m.busy}
                  onClick={() =>
                    m.setLines((old) =>
                      old
                        .map((i) => (i.key === l.key ? { ...i, quantity: i.quantity - 1 } : i))
                        .filter((i) => i.quantity > 0),
                    )
                  }
                >
                  <Minus size={15} />
                </button>
                <span>{l.quantity}</span>
                <button
                  aria-label={`Sumar ${l.name}`}
                  disabled={m.busy}
                  onClick={() =>
                    m.setLines((old) =>
                      old.map((i) => (i.key === l.key ? { ...i, quantity: i.quantity + 1 } : i)),
                    )
                  }
                >
                  <Plus size={15} />
                </button>
              </div>
              <strong>{money(l.price * l.quantity)}</strong>
              <button
                aria-label={`Quitar ${l.name}`}
                disabled={m.busy}
                className="danger"
                onClick={() => m.setLines((old) => old.filter((i) => i.key !== l.key))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <section className="pos-payment" aria-label="Cobro">
          {m.type === 'EMPLOYEE' && <p className="note">Mi consumo · descuento del 20%</p>}
          {m.type === 'OWNER' ? (
            <label>
              Motivo del retiro
              <input
                disabled={m.busy}
                value={m.note}
                onChange={(e) => m.setNote(e.target.value)}
                required
              />
            </label>
          ) : (
            <div className="pos-methods" role="radiogroup" aria-label="Medio de pago">
              {methods.map((method) => (
                <button
                  role="radio"
                  disabled={m.busy}
                  aria-checked={m.method === method.id}
                  className={m.method === method.id ? 'selected' : ''}
                  onClick={() => m.setMethod(method.id)}
                  key={method.id}
                >
                  <method.icon size={18} />
                  <span>{method.name}</span>
                </button>
              ))}
            </div>
          )}
          {m.lines.length > 0 && m.type !== 'OWNER' && (
            <div className="pos-payment-fields">
              {m.method === 'MIXED' && (
                <label>
                  Parte en efectivo ($)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={m.cash}
                    disabled={m.busy}
                    onChange={(e) => m.setCash(e.target.value)}
                  />
                  <small>
                    Mercado Pago:{' '}
                    {money(m.total - (Number.isFinite(m.cashAmount) ? m.cashAmount : 0))}
                  </small>
                </label>
              )}
              {['CASH', 'MIXED'].includes(m.method) && (
                <>
                  <label>
                    Efectivo recibido ($)
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={m.received}
                      disabled={m.busy}
                      onChange={(e) => m.setReceived(e.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <div className="row between">
                    <span className="muted">{m.change >= 0 ? 'Vuelto' : 'Falta'}</span>
                    <strong>{money(Math.abs(m.change))}</strong>
                  </div>
                </>
              )}
            </div>
          )}
          {m.night && m.type === 'SALE' && (
            <small className="row">
              <Moon size={14} /> Tarifa nocturna +10%
            </small>
          )}
          <div className="row between pos-total">
            <span className="muted">Total</span>
            <strong>{money(m.total)}</strong>
          </div>
          <button
            className="pos-charge"
            aria-label={m.type === 'OWNER' ? 'Registrar retiro' : 'Confirmar cobro'}
            disabled={
              m.busy ||
              m.scanning > 0 ||
              !m.shift ||
              !m.lines.length ||
              (!m.quoteValid && !m.offlineReady) ||
              (m.type === 'OWNER' && !m.note.trim())
            }
            onClick={() => void m.charge()}
          >
            {m.busy
              ? 'Guardando…'
              : `${m.type === 'OWNER' ? 'Registrar retiro' : 'Cobrar'} ${money(m.total)}`}
          </button>
          {m.offlineReady && <small>Sin conexión: cobro pendiente de validación.</small>}
          {!!m.lines.length && m.online && !m.quoteValid && <small>Actualizando cotización…</small>}
        </section>
      </section>
      <aside
        className={`pos-turn ${summaryOpen ? 'expanded' : ''}`}
        aria-label="Resumen de este turno"
      >
        <button
          className="pos-turn-heading"
          aria-expanded={summaryOpen}
          onClick={() => setSummaryOpen(!summaryOpen)}
        >
          <span>ESTE TURNO</span>
          <strong>{money(collected)}</strong>
          <ChevronDown size={16} />
        </button>
        <div className="pos-turn-body">
          <div className="pos-turn-sales">
            {!m.shift?.operations.length && <p className="empty">Sin ventas aún</p>}
            {m.shift?.operations.map((o) => (
              <details key={o.id} className="pos-sale">
                <summary>
                  <span>
                    <strong>
                      {o.type === 'OWNER'
                        ? 'Retiro'
                        : o.type === 'EMPLOYEE'
                          ? 'Mi consumo'
                          : 'Venta'}
                    </strong>
                    <small>
                      {new Date(o.createdAt).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'America/Argentina/Buenos_Aires',
                      })}{' '}
                      · {o.payments.map((p) => paymentNames[p.method]).join(' + ')}
                    </small>
                  </span>
                  <strong>{money(o.total)}</strong>
                </summary>
                <p>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
              </details>
            ))}
          </div>
          <footer>
            <span>Ventas</span>
            <strong>
              {m.shift?.saleCount ??
                m.shift?.operations.filter((o) => o.type === 'SALE').length ??
                0}
            </strong>
          </footer>
        </div>
      </aside>
    </div>
  );
}
