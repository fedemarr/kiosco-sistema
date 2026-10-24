import { expect, test } from 'vitest';
import { GET } from '../src/app/api/health/route';
test('health público, sin caché', async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect((await response.json()).data.status).toBe('ok');
});
