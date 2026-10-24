export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown,
    public status?: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Sin conexión: la operación no fue confirmada por el servidor.', 'NETWORK');
  }
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new ApiError(
      result.error?.message || 'No se pudo completar la operación.',
      result.error?.code || 'ERROR',
      result.error?.details,
      response.status,
    );
  return result.data as T;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Ocurrió un error. Volvé a intentar.';
