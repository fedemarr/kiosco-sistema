export const TIMEZONE = 'America/Argentina/Buenos_Aires';
export const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: cents % 100 ? 2 : 0,
  })
    .format(cents / 100)
    .replace(/\s/g, '');
export const dateTime = (value: string | Date) =>
  new Intl.DateTimeFormat('es-AR', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
export function businessDate(date = new Date(), night = false) {
  const shifted = new Date(date.getTime() - 3 * 3600000);
  if (night && shifted.getUTCHours() < 6) shifted.setUTCDate(shifted.getUTCDate() - 1);
  return shifted.toISOString().slice(0, 10);
}
export function isNight(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en', { timeZone: TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(
      date,
    ),
  );
  return hour >= 22 || hour < 6;
}
export const normalizeUsername = (value: string) => value.toLowerCase().replace(/\s/g, '');
export function nextTariffDelay(now = new Date()) {
  const local = new Date(now.getTime() - 3 * 3600000);
  const next = new Date(local);
  if (local.getUTCHours() < 6) next.setUTCHours(6, 0, 0, 0);
  else if (local.getUTCHours() < 22) next.setUTCHours(22, 0, 0, 0);
  else {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(6, 0, 0, 0);
  }
  return Math.max(1, next.getTime() + 3 * 3600000 - now.getTime());
}
export function toCents(value: string) {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
