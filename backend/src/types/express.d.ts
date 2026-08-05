import type { SessionAuth } from '../modules/auth/guards/session.guard';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      auth?: SessionAuth;
    }
  }
}

export {};
