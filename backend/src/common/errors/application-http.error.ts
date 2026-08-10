export class ApplicationHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApplicationHttpError';
  }

  getResponse() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
