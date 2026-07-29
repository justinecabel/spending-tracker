import type {
  Budget,
  BudgetUpsertInput,
  Category,
  Countdown,
  CountdownUpsertInput,
  CreateCategoryInput,
  CreateDebtInput,
  CreateTransactionInput,
  Debt,
  Transaction,
  UpdateDebtInput,
  UpdateUserPreferencesInput,
  User,
} from "@spending-tracker/shared";
import { api } from "../lib/api";

/**
 * The optional off-device copy of a profile.
 *
 * Keeping this contract separate from the on-device backend means the app can
 * continue to work when this adapter is unreachable, and lets another remote
 * storage provider replace the HTTP API without changing screens.
 */
export type RemoteStorage = {
  categories: () => Promise<Category[]>;
  createCategory: (input: CreateCategoryInput) => Promise<Category>;
  updateCategory: (
    id: string,
    input: Partial<CreateCategoryInput> & { archived?: boolean },
  ) => Promise<Category>;
  deleteCategory: (id: string) => Promise<Category>;
  transactions: (query?: Record<string, string>) => Promise<Transaction[]>;
  createTransaction: (input: CreateTransactionInput) => Promise<Transaction>;
  updateTransaction: (id: string, input: Partial<CreateTransactionInput>) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
  debts: () => Promise<Debt[]>;
  createDebt: (input: CreateDebtInput) => Promise<Debt>;
  updateDebt: (id: string, input: UpdateDebtInput) => Promise<Debt>;
  deleteDebt: (id: string) => Promise<void>;
  countdown: () => Promise<Countdown | null>;
  upsertCountdown: (input: CountdownUpsertInput) => Promise<Countdown>;
  deleteCountdown: () => Promise<void>;
  budgets: (month: string) => Promise<Budget[]>;
  upsertBudget: (input: BudgetUpsertInput) => Promise<Budget>;
  updateMe: (input: UpdateUserPreferencesInput) => Promise<{ user: User }>;
};

export const remoteStorage: RemoteStorage = {
  categories: api.categories,
  createCategory: api.createCategory,
  updateCategory: api.updateCategory,
  deleteCategory: api.deleteCategory,
  transactions: api.transactions,
  createTransaction: api.createTransaction,
  updateTransaction: api.updateTransaction,
  deleteTransaction: api.deleteTransaction,
  debts: api.debts,
  createDebt: api.createDebt,
  updateDebt: api.updateDebt,
  deleteDebt: api.deleteDebt,
  countdown: api.countdown,
  upsertCountdown: api.upsertCountdown,
  deleteCountdown: api.deleteCountdown,
  budgets: api.budgets,
  upsertBudget: api.upsertBudget,
  updateMe: api.updateMe,
};
