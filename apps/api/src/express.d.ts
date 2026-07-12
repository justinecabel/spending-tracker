import type { User } from "@spending-tracker/shared";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
