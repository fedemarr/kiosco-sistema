'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PosScreen } from './pos-screen';
import { request, errorMessage, ApiError } from '@/lib/client';
import { money, isNight, toCents, nextTariffDelay } from '@/lib/format';
import type { Product, ProductList, Quick, Category, Quotation, Shift, Payment } from '@/lib/types';
import type { CartInput, CheckoutInput } from './schema';
import { useUser } from '@/components/app-shell';
import { enqueue, removePendingSale } from '@/modules/offline/queue';
import { cacheCatalog, readSnapshot, saveSnapshot, warmCatalog } from '@/modules/offline/catalog';
import { matchesProduct } from '@/lib/product-search';
type Line = {
  key: string;
  name: string;
  price: number;
  quantity: number;
  kind: 'product' | 'quick' | 'custom';
  productId?: string;
  quickId?: string;
};
function usePos() {
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
  const [scanning, setScanning] = useState(0);
  const scanCount = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [custom, setCustom] = useState(false);
  const [online, setOnline] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const warmed = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const chargeLock = useRef(false);
  const lastRequest = useRef<{ key: string; confirmed: boolean } | null>(null);
  const bindSearch = useCallback((node: HTMLInputElement | null) => {
    searchRef.current = node;
  }, []);
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
    if (chargeLock.current) return;
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
    const changed = () => {
      setRefreshKey((key) => key + 1);
      void load();
    };
    const confirmed = (event: Event) => {
      const { key, id } = (event as CustomEvent<{ key: string; id: string }>).detail;
      if (lastRequest.current?.key === key) {
        lastRequest.current.confirmed = true;
        setMessage(`Cobro sincronizado y confirmado · ${id.slice(0, 8)}`);
      }
    };
    const interval = setInterval(changed, 15000);
    window.addEventListener('offline', offline);
    window.addEventListener('queue-change', changed);
    window.addEventListener('stock-change', changed);
    window.addEventListener('sale-confirmed', confirmed);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', visibility);
      window.removeEventListener('offline', offline);
      window.removeEventListener('queue-change', changed);
      window.removeEventListener('stock-change', changed);
      window.removeEventListener('sale-confirmed', confirmed);
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
        const matched = snapshot.products.filter(
          (p) => matchesProduct(p, search) && (!category || p.categoryId === category),
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
          if (!cancelled && !(e instanceof ApiError && e.code === 'NETWORK')) {
            setQuotation(null);
            setError(errorMessage(e));
          }
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
  const cashAmount =
    type === 'OWNER' ? 0 : method === 'MIXED' ? toCents(cash) : method === 'CASH' ? total : 0;
  const change = toCents(received || '0') - cashAmount;
  async function charge(exactCash = false) {
    if (chargeLock.current || scanCount.current > 0 || (!quoteValid && !offlineReady) || !shift)
      return;
    chargeLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const receivedAmount = exactCash && method === 'CASH' ? total : toCents(received || '0');
    const paymentChange = receivedAmount - cashAmount;
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
      (cashAmount > 0 && (!Number.isFinite(paymentChange) || paymentChange < 0))
    ) {
      setError('Revisá los importes: el efectivo recibido debe alcanzar.');
      setBusy(false);
      chargeLock.current = false;
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
      ...(cashAmount > 0 ? { received: receivedAmount } : {}),
    };
    try {
      // Guardar la clave antes de enviar: una recarga o respuesta perdida conserva el mismo cobro.
      lastRequest.current = { key: payload.idempotencyKey, confirmed: false };
      await enqueue(user.id, payload);
    } catch {
      setError(
        'No se pudo guardar el cobro de forma segura en este dispositivo. No se envió al servidor. Conservá el carrito y revisá el almacenamiento del navegador.',
      );
      setBusy(false);
      chargeLock.current = false;
      return;
    }
    try {
      if (offlineReady) {
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
      await removePendingSale(payload.idempotencyKey).catch(() => {});
      setMessage(`Cobro registrado · ${result.id.slice(0, 8)} · ${money(total)}`);
      setLines([]);
      setReceived('');
      setCash('');
      setRefreshKey((key) => key + 1);
      void load();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'NETWORK' || (e.status && e.status >= 500))) {
        setMessage(
          lastRequest.current?.confirmed
            ? 'Cobro sincronizado y confirmado.'
            : 'Cobro guardado como pendiente en este dispositivo. Todavía no está confirmado. Conservá el dispositivo y sincronizá al volver la conexión.',
        );
        setLines([]);
        setReceived('');
        setCash('');
      } else {
        try {
          await removePendingSale(payload.idempotencyKey);
        } catch {
          setLines([]);
          setMessage(
            'Cobro pendiente de revisión en este dispositivo. Verificá su estado antes de repetirlo.',
          );
          return;
        }
        if (e instanceof ApiError && e.code === 'QUOTE_CHANGED') {
          const next = (e.details as { quote: Quotation }).quote;
          setQuotation(next);
          setQuoteKey(cartKey);
          setError(
            `El total cambió de ${money(total)} a ${money(next.total)}. ${next.total > total ? `Cobrá ${money(next.total - total)} más` : `Devolvé ${money(total - next.total)}`}. Revisá el pago y confirmá otra vez.`,
          );
        } else setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
      chargeLock.current = false;
    }
  }
  function addProduct(p: Product, clearSearch = true) {
    if (chargeLock.current) return;
    add({ kind: 'product', key: p.id, productId: p.id, name: p.name, price: p.price });
    if (clearSearch) {
      setSearch('');
      setPage(1);
    }
  }
  async function scan() {
    if (!search.trim() || chargeLock.current) return;
    const query = search.trim();
    setSearch('');
    setProducts([]);
    scanCount.current++;
    setScanning(scanCount.current);
    try {
      const candidates = online
        ? (await request<ProductList>('catalog?q=' + encodeURIComponent(query))).products
        : ((await readSnapshot(user.id))?.products || []).filter((p) => matchesProduct(p, query));
      const p =
        candidates.find((p) => p.barcode.toLowerCase() === query.toLowerCase()) ||
        (candidates.length === 1 ? candidates[0] : undefined);
      if (p) addProduct(p, false);
      else setError('Elegí un producto de los resultados o revisá el código.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      scanCount.current--;
      setScanning(scanCount.current);
    }
  }
  return {
    user,
    products,
    totalProducts,
    page,
    setPage,
    quick,
    categories,
    category,
    setCategory,
    search,
    setSearch: (value: string) => {
      setSearch(value);
      setProducts([]);
      setLoading(true);
    },
    lines,
    setLines,
    type,
    setType,
    note,
    setNote,
    quotation,
    shift,
    method,
    setMethod,
    cash,
    setCash,
    received,
    setReceived,
    night,
    busy,
    scanning,
    loading,
    error,
    setError,
    message,
    custom,
    setCustom,
    online,
    bindSearch,
    add,
    addProduct,
    scan,
    quoteValid,
    offlineReady,
    displaySubtotal,
    total,
    cashAmount,
    change,
    charge,
  };
}
export type PosModel = Omit<ReturnType<typeof usePos>, 'bindSearch'>;
export function Pos() {
  const { bindSearch, ...model } = usePos();
  return <PosScreen model={model} inputRef={bindSearch} />;
}
