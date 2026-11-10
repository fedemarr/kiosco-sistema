'use client';
export const SHIFT_CHANGE_KEY = 'kiosco-shift-change';
export function publishShiftChange() {
  window.dispatchEvent(new Event('shift-change'));
  try {
    localStorage.setItem(SHIFT_CHANGE_KEY, crypto.randomUUID());
  } catch {
    /* El servidor sigue siendo la autoridad si el navegador bloquea storage. */
  }
}
