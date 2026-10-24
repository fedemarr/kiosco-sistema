'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingBasket,
  ArrowRight,
  Moon,
  ScanBarcode,
} from 'lucide-react';
import Link from 'next/link';
import { request, errorMessage, ApiError } from '@/lib/client';
import { money, isNight, toCents, nextTariffDelay } from '@/lib/format';
import type { Product, ProductList, Quick, Category, Quotation, Shift, Payment } from '@/lib/types';
import type { CartInput, CheckoutInput } from './schema';
import { useUser } from '@/components/app-shell';
import { can } from '@/modules/auth/permissions';
import { enqueue } from '@/modules/offline/queue';
import { cacheCatalog, readSnapshot, saveSnapshot, warmCatalog } from '@/modules/offline/catalog';
type Line = {
  key: string;
  name: string;
  price: number;
  quantity: number;
  kind: 'product' | 'quick' | 'custom';
  productId?: string;
  quickId?: string;
};
export function Pos() {
  const user = useUser();
  const [products, setProducts] = useState<Product[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(1);
  const [quick, setQuick] = useState<Quick[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [type, setType] = useState<CartInput['type']>('SALE');
  const [note, setNote] = useState('');
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [quoteKey, setQuoteKey] = useState('');
  const [shift, setShift] = useState<Shift | null>(null);
  const [method, setMethod] = useState('CASH');
  const [cash, setCash] = useState('');
  const [received, setReceived] = useState('');
  const [night, setNight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [custom, setCustom] = useState(false);
  const [online, setOnline] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const warmed = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const cart: CartInput = {
    type,
    items: lines.map((l) =>
      l.kind === 'product'
        ? { kind: 'product', productId: l.productId!, quantity: l.quantity }
        : l.kind === 'quick'
          ? { kind: 'quick', quickId: l.quickId!, quantity: l.quantity }
          : { kind: 'custom', name: l.name, price: l.price, quantity: l.quantity },
    ),
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  const cartKey = JSON.stringify(cart);
  const add = useCallback((line: Omit<Line, 'quantity'>) => {
    setLines((old) => {
      const match = old.find((l) => l.key === line.key);
      return match
        ? old.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l))
        : [...old, { ...line, quantity: 1 }];
    });
    setMessage('');
    searchRef.current?.focus();
  }, []);
  const load = useCallback(async () => {
    try {
      if (!navigator.onLine) throw new ApiError('Sin conexión', 'NETWORK');
      const [s, q, c] = await Promise.all([
        request<Shift | null>('shifts/current'),
        request<Quick[]>('quick'),
        request<Category[]>('categories'),
      ]);
      setShift(s);
      setQuick(q);
      setCategories(c);
      setOnline(true);
      await saveSnapshot(user, s, q, c).catch(() => {});
      if (!warmed.current) {
        warmed.current = true;
        void warmCatalog(user.id).catch(() => {
          warmed.current = false;
        });
      }
    } catch (e) {
      const snapshot = await readSnapshot(user.id).catch(() => null);
      if (e instanceof ApiError && e.code === 'NETWORK' && snapshot) {
        setShift(snapshot.shift);
        setQuick(snapshot.quick);
        setCategories(snapshot.categories);
        setOnline(false);
      } else setError(errorMessage(e));
    }
  }, [user]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    const visibility = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener('online', visibility);
    const offline = () => {
      setOnline(false);
      void load();
    };
    const changed = () => setRefreshKey((key) => key + 1);
    const interval = setInterval(changed, 15000);
    window.addEventListener('offline', offline);
    window.addEventListener('queue-change', changed);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', visibility);
      window.removeEventListener('offline', offline);
      window.removeEventListener('queue-change', changed);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const cached = async () => {
        const snapshot = await readSnapshot(user.id);
        if (!snapshot)
          throw new ApiError('No hay catálogo guardado. Conectate para prepararlo.', 'NETWORK');
        const q = search.toLocaleLowerCase();
        const matched = snapshot.products.filter(
          (p) =>
            (!q ||
              p.name.toLocaleLowerCase().includes(q) ||
              p.barcode.toLocaleLowerCase().includes(q)) &&
            (!category || p.categoryId === category),
        );
        return { products: matched.slice((page - 1) * 60, page * 60), total: matched.length, page };
      };
      void (
        online
          ? request<ProductList>(
              `catalog?q=${encodeURIComponent(search)}&page=${page}&category=${category}`,
            ).then(async (value) => {
              await cacheCatalog(user.id, value.products).catch(() => {});
              return value;
            })
          : cached()
      )
        .then((data) => {
          if (!cancelled) {
            setProducts(data.products);
            setTotalProducts(data.total);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, page, category, online, user.id, refreshKey]);
  useEffect(() => {
    let cancelled = false;
    const getQuote = () => {
      setNight(isNight());
      if (!navigator.onLine) return;
      if (!JSON.parse(cartKey).items.length) {
        setQuotation(null);
        setQuoteKey('');
        return;
      }
      void request<Quotation>('sales/quote', 'POST', JSON.parse(cartKey))
        .then((q) => {
          if (!cancelled) {
            setQuotation(q);
            setQuoteKey(cartKey);
            setError('');
          }
        })
        .catch((e) => {
          if (!cancelled && !(e instanceof ApiError && e.code === 'NETWORK'))
            setError(errorMessage(e));
        });
    };
    const timer = setTimeout(getQuote, 150);
    // Programar el cambio para 22:00/06:00, incluso sin tráfico de red.
    let clock: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clock = setTimeout(() => {
        getQuote();
        schedule();
      }, nextTariffDelay());
    };
    schedule();
    const visibility = () => {
      if (!document.hidden) {
        getQuote();
        clearTimeout(clock);
        schedule();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', getQuote);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(clock);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', getQuote);
    };
  }, [cartKey]);
  const quoteValid =
    online && quotation && quoteKey === cartKey && (type !== 'SALE' || quotation.night === night);
  const offlineReady = !online && !!shift?.offlineToken && type !== 'OWNER';
  const displaySubtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const total = quoteValid
    ? quotation.total
    : type === 'EMPLOYEE'
      ? displaySubtotal - Math.round(displaySubtotal * 0.2)
      : displaySubtotal + (type === 'SALE' && night ? Math.round(displaySubtotal * 0.1) : 0);
  const cashAmount = method === 'MIXED' ? toCents(cash) : method === 'CASH' ? total : 0;
  const change = toCents(received || '0') - cashAmount;
  async function charge() {
    if ((!quoteValid && !offlineReady) || !shift) return;
    setBusy(true);
    setError('');
    setMessage('');
    const payments: Payment[] =
      type === 'OWNER'
        ? []
        : method === 'MIXED'
          ? [
              { method: 'CASH', amount: cashAmount },
              { method: 'MP', amount: total - cashAmount },
            ]
          : [{ method: method as Payment['method'], amount: total }];
    if (
      payments.some((p) => !Number.isInteger(p.amount) || p.amount < 0) ||
      (cashAmount > 0 && change < 0)
    ) {
      setError('Revisá los importes: el efectivo recibido debe alcanzar.');
      setBusy(false);
      return;
    }
    const payload: CheckoutInput = {
      ...cart,
      shiftId: shift.id,
      idempotencyKey: crypto.randomUUID(),
      ...(offlineReady
        ? { offline: true, offlineToken: shift.offlineToken, expectedTotal: total }
        : { quoteToken: quotation!.quoteToken }),
      payments,
      ...(cashAmount > 0 ? { received: toCents(received) } : {}),
    };
    try {
      if (offlineReady) {
        await enqueue(user.id, payload);
        setMessage(
          'Cobro guardado como pendiente en este dispositivo. Todavía no está confirmado. Se validarán precio, turno y stock al sincronizar.',
        );
        setLines([]);
        setReceived('');
        setCash('');
        setRefreshKey((key) => key + 1);
        return;
      }
      const result = await request<{ id: string }>('sales', 'POST', payload);
      setMessage(`Cobro registrado · ${result.id.slice(0, 8)} · ${money(total)}`);
      setLines([]);
      setReceived('');
      setCash('');
      setRefreshKey((key) => key + 1);
      void load();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'NETWORK' || (e.status && e.status >= 500))) {
        try {
          await enqueue(user.id, payload);
          setMessage(
            'Cobro guardado como pendiente en este dispositivo. Todavía no está confirmado. Conservá el dispositivo y sincronizá al volver la conexión.',
          );
          setLines([]);
          setReceived('');
          setCash('');
        } catch {
          setError(
            'No se pudo guardar en el dispositivo. Conservá el carrito y verificá el cobro con el dueño.',
          );
        }
      } else if (e instanceof ApiError && e.code === 'QUOTE_CHANGED') {
        const next = (e.details as { quote: Quotation }).quote;
        setQuotation(next);
        setQuoteKey(cartKey);
        setError(
          `El total cambió de ${money(total)} a ${money(next.total)}. ${next.total > total ? `Cobrá ${money(next.total - total)} más` : `Devolvé ${money(total - next.total)}`}. Revisá el pago y confirmá otra vez.`,
        );
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-head row between">
        <div>
          <p className="overline">Punto de venta</p>
          <h1>Listos para un buen día.</h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Buscá, agregá y cobrá. Así de simple.
          </p>
        </div>
        <div className="stack">
          <span className="pill">● {shift ? 'Turno abierto' : 'Sin turno abierto'}</span>
          {night && (
            <span className="pill">
              <Moon size={14} />
              Tarifa nocturna +10%
            </span>
          )}
        </div>
      </header>
      {!shift && (
        <p className="note">
          Para cobrar necesitás abrir tu turno.{' '}
          <Link href="/turnos">
            <strong>Abrir turno →</strong>
          </Link>
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="grid workspace">
        <section className="stack">
          <div className="search">
            <Search size={21} />
            <input
              ref={searchRef}
              aria-label="Buscar producto"
              placeholder="Buscá un producto o escaneá el código"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const p = products.find((p) => p.barcode.toLowerCase() === search.toLowerCase());
                  if (p) {
                    add({
                      kind: 'product',
                      key: p.id,
                      productId: p.id,
                      name: p.name,
                      price: p.price,
                    });
                    setSearch('');
                  } else setError('No encontramos ese código. Esperá la búsqueda o revisalo.');
                }
              }}
            />
          </div>
          <div className="row between">
            <small className="row">
              <ScanBarcode size={15} />
              Lector de código compatible
            </small>
            <small>{totalProducts} productos</small>
          </div>
          <div className="row">
            <select
              aria-label="Filtrar por categoría"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              style={{ width: 'auto', maxWidth: '100%' }}
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button onClick={() => setCustom(!custom)}>+ Venta rápida</button>
          </div>
          {custom && (
            <form
              className="card stack"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const name = String(d.get('name'));
                const price = toCents(String(d.get('price')));
                if (!Number.isInteger(price) || price <= 0) {
                  setError('Ingresá un precio válido.');
                  return;
                }
                add({ kind: 'custom', key: crypto.randomUUID(), name, price });
                setCustom(false);
              }}
            >
              <h2>Venta rápida</h2>
              <label>
                Descripción
                <input name="name" minLength={2} maxLength={100} required />
              </label>
              <label>
                Precio ($)
                <input name="price" type="number" min="0.01" step="0.01" required />
              </label>
              <button className="primary">Agregar al carrito</button>
            </form>
          )}
          <div>
            <p className="overline">A un toque</p>
            <div className="row">
              {quick.map((q) => (
                <button
                  key={q.id}
                  onClick={() =>
                    add({ kind: 'quick', key: q.id, quickId: q.id, name: q.name, price: q.price })
                  }
                >
                  {q.emoji} {q.name} <small>{money(q.price)}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="row between">
            <h2 style={{ margin: 0 }}>Tu catálogo</h2>
            <span className="badge">{loading ? 'BUSCANDO…' : 'PRODUCTOS'}</span>
          </div>
          {!loading && !products.length && (
            <div className="card empty">
              <PackageEmpty />
              <p>Todavía no hay productos para mostrar.</p>
              <small>
                {search
                  ? 'Probá con otro nombre o código.'
                  : 'Cargá productos desde Stock. La importación se hará después.'}
              </small>
            </div>
          )}
          <div className="product-grid">
            {products.map((p) => (
              <button
                className="product-tile"
                key={p.id}
                disabled={p.trackStock && p.stock <= 0}
                onClick={() =>
                  add({ kind: 'product', key: p.id, productId: p.id, name: p.name, price: p.price })
                }
              >
                <small>{p.category.name}</small>
                <strong>{p.name}</strong>
                <span className="price">{money(p.price)}</span>
                <small>{p.trackStock ? `${p.stock} disponibles` : 'Sin límite de stock'}</small>
              </button>
            ))}
          </div>
          {totalProducts > 60 && (
            <div className="row">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </button>
              <small>Página {page}</small>
              <button disabled={page * 60 >= totalProducts} onClick={() => setPage(page + 1)}>
                Siguiente
              </button>
            </div>
          )}
        </section>
        <aside className="card cart stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Venta actual</h2>
            <span className="pill">{lines.reduce((s, l) => s + l.quantity, 0)} ítems</span>
          </div>
          <label>
            Operación
            <select value={type} onChange={(e) => setType(e.target.value as CartInput['type'])}>
              <option value="SALE">Venta</option>
              <option value="EMPLOYEE">Consumo de empleado · −20%</option>
              {can(user, 'owner') && <option value="OWNER">Retiro del dueño · a costo</option>}
            </select>
          </label>
          {!lines.length && (
            <div className="empty">
              <ShoppingBasket size={36} style={{ margin: '0 auto 12px' }} />
              <p>Tu próxima venta empieza acá.</p>
              <small>Agregá productos al carrito.</small>
            </div>
          )}
          {lines.map((l) => (
            <div key={l.key} className="cart-line stack">
              <div className="row between">
                <strong>{l.name}</strong>
                <button
                  aria-label={`Quitar ${l.name}`}
                  onClick={() => setLines(lines.filter((i) => i.key !== l.key))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="row between">
                <div className="quantity row">
                  <button
                    aria-label={`Restar ${l.name}`}
                    onClick={() =>
                      setLines(
                        lines
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
                    onClick={() =>
                      setLines(
                        lines.map((i) =>
                          i.key === l.key ? { ...i, quantity: i.quantity + 1 } : i,
                        ),
                      )
                    }
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <span>{money(l.price * l.quantity)}</span>
              </div>
            </div>
          ))}
          {type === 'OWNER' && (
            <label>
              Motivo del retiro
              <input value={note} onChange={(e) => setNote(e.target.value)} required />
            </label>
          )}
          <div className="stack">
            <div className="row between">
              <span className="muted">Subtotal</span>
              <span>{money(quoteValid ? quotation.subtotal : displaySubtotal)}</span>
            </div>
            {quoteValid && quotation.adjustment !== 0 && (
              <div className="row between">
                <span className="muted">
                  {type === 'EMPLOYEE' ? 'Descuento empleado' : 'Recargo nocturno'}
                </span>
                <span>{money(quotation.adjustment)}</span>
              </div>
            )}
            <div className="row between">
              <strong>Total</strong>
              <span className="total">{money(total)}</span>
            </div>
          </div>
          {type !== 'OWNER' && (
            <>
              <label>
                Medio de pago
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="CASH">Efectivo</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="MP">Mercado Pago / Transferencia</option>
                  <option value="MIXED">Mixto · Efectivo + MP</option>
                </select>
              </label>
              {method === 'MIXED' && (
                <>
                  <label>
                    Parte en efectivo ($)
                    <input
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.01"
                      value={cash}
                      onChange={(e) => setCash(e.target.value)}
                    />
                  </label>
                  <small>
                    Mercado Pago: {money(total - (Number.isFinite(cashAmount) ? cashAmount : 0))}
                  </small>
                </>
              )}
              {['CASH', 'MIXED'].includes(method) && (
                <>
                  <label>
                    Efectivo recibido ($)
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={received}
                      onChange={(e) => setReceived(e.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <div className="row between">
                    <span className="muted">{change >= 0 ? 'Vuelto' : 'Falta'}</span>
                    <strong>{money(Math.abs(change))}</strong>
                  </div>
                </>
              )}
            </>
          )}
          <button
            className="primary row between full"
            disabled={
              busy ||
              !shift ||
              !lines.length ||
              (!quoteValid && !offlineReady) ||
              (type === 'OWNER' && !note.trim())
            }
            onClick={() => void charge()}
          >
            <span>
              {busy ? 'Guardando…' : type === 'OWNER' ? 'Registrar retiro' : 'Confirmar cobro'}
            </span>
            <ArrowRight size={19} />
          </button>
          <small style={{ textAlign: 'center' }}>
            {offlineReady
              ? 'Sin conexión: precio estimado, pendiente de validación.'
              : lines.length && !quoteValid
                ? 'Esperando cotización del servidor…'
                : 'El cobro se registra una sola vez.'}
          </small>
        </aside>
      </div>
    </>
  );
}
function PackageEmpty() {
  return <ShoppingBasket size={32} style={{ margin: '0 auto 14px' }} />;
}
