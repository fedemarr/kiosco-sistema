export class AppError extends Error {
  constructor(
    public message: string,
    public status = 400,
    public code = 'VALIDATION',
    public details?: unknown,
  ) {
    super(message);
  }
}
