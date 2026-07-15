import { z } from "zod";

export const transactionKindSchema = z.literal("expense");
export const expenseKindSchema = transactionKindSchema;

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email().nullable(),
  name: z.string(),
  avatarUrl: z.string().url().nullable(),
  googleSub: z.string().nullable(),
  deviceId: z.string().nullable(),
  isDeviceOnly: z.boolean(),
  currency: z.string().default("USD"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const categorySchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  kind: transactionKindSchema,
  color: z.string(),
  icon: z.string(),
  isSystem: z.boolean().default(false),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const transactionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  categoryId: z.string(),
  amount: z.number().positive(),
  kind: transactionKindSchema,
  occurredAt: z.string(),
  note: z.string().nullable(),
  merchant: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const budgetSchema = z.object({
  id: z.string(),
  userId: z.string(),
  categoryId: z.string().nullable(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().nonnegative(),
  rollover: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const authResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const profileSlotSchema = z.enum(["device", "linked"]);

export const transferTokenResponseSchema = z.object({
  token: z.string(),
  pairingCode: z.string(),
  expiresAt: z.string(),
  qrValue: z.string(),
});

export const consumeTransferTokenInputSchema = z.object({
  token: z.string().min(1),
});

export const importDeviceDataInputSchema = z.object({
  sourceUserId: z.string().min(1),
  deviceId: z.string().min(1),
});

export const ownDeviceDataInputSchema = z.object({
  deviceId: z.string().min(1),
});

export const importDeviceDataResultSchema = z.object({
  importedCategories: z.number().int().nonnegative(),
  importedTransactions: z.number().int().nonnegative(),
  importedBudgets: z.number().int().nonnegative(),
});

export const ownDeviceDataResultSchema = importDeviceDataResultSchema.extend({
  deviceUser: userSchema,
});

export const updateUserPreferencesInputSchema = z.object({
  currency: z.string().trim().min(3).max(3).transform((value) => value.toUpperCase()),
});

export const createCategoryInputSchema = z.object({
  name: z.string().min(1),
  kind: expenseKindSchema.default("expense"),
  color: z.string().default("#2F855A"),
  icon: z.string().default("wallet"),
});

export const updateCategoryInputSchema = createCategoryInputSchema.partial().extend({
  archived: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const createTransactionInputSchema = z.object({
  categoryId: z.string(),
  amount: z.number().positive(),
  kind: expenseKindSchema.default("expense"),
  occurredAt: z.string(),
  note: z.string().trim().min(1).max(280).optional().nullable(),
  merchant: z.string().trim().min(1).max(140).optional().nullable(),
  clientId: z.string().min(1).optional(),
});

export const updateTransactionInputSchema = createTransactionInputSchema.partial();

export const transactionQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  categoryId: z.string().optional(),
  kind: transactionKindSchema.optional(),
  search: z.string().optional(),
});

export const budgetUpsertInputSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().nullable(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().nonnegative(),
});

export const monthlyReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export const reportCategorySchema = z.object({
  categoryId: z.string().nullable(),
  categoryName: z.string(),
  total: z.number(),
  budget: z.number().nullable(),
  variance: z.number().nullable(),
});

export const monthlyReportSchema = z.object({
  month: z.string(),
  expenseTotal: z.number(),
  byCategory: z.array(reportCategorySchema),
  budgetTotal: z.number(),
  budgetRemaining: z.number(),
});

export const aiPredictionTransactionSchema = z.object({
  amount: z.number().positive(),
  occurredAt: z.string(),
  category: z.string().min(1),
  merchant: z.string().nullable(),
  note: z.string().nullable(),
});

export const aiPredictionRequestSchema = z.object({
  instruction: z.string().trim().min(1).max(1000),
  range: z.object({
    title: z.string().min(1),
    from: z.string().nullable(),
    to: z.string().nullable(),
    forecastTo: z.string().nullable(),
  }),
  currency: z.string().trim().min(3).max(3),
  categoryNames: z.array(z.string().min(1)).max(20),
  forecastDates: z.array(z.string()).max(62),
  transactions: z.array(aiPredictionTransactionSchema).max(2000),
});

export const aiPredictionCategorySchema = z.object({
  category: z.string().min(1),
  projectedTotal: z.number().nonnegative(),
});

export const aiPredictionPointSchema = z.object({
  date: z.string().min(1),
  projectedAmount: z.number().nonnegative(),
});

export const aiPredictionResponseSchema = z.object({
  projectedTotal: z.number().nonnegative(),
  categories: z.array(aiPredictionCategorySchema).max(20),
  points: z.array(aiPredictionPointSchema).max(62),
});

export const syncMutationSchema = z.object({
  id: z.string(),
  userId: z.string().min(1),
  entity: z.enum(["transaction", "category", "budget", "preferences"]),
  action: z.enum(["create", "update", "delete", "upsert"]),
  payload: z.record(z.any()),
  createdAt: z.string(),
});

export type User = z.infer<typeof userSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type ProfileSlot = z.infer<typeof profileSlotSchema>;
export type TransferTokenResponse = z.infer<typeof transferTokenResponseSchema>;
export type ConsumeTransferTokenInput = z.infer<typeof consumeTransferTokenInputSchema>;
export type ImportDeviceDataInput = z.infer<typeof importDeviceDataInputSchema>;
export type ImportDeviceDataResult = z.infer<typeof importDeviceDataResultSchema>;
export type OwnDeviceDataInput = z.infer<typeof ownDeviceDataInputSchema>;
export type OwnDeviceDataResult = z.infer<typeof ownDeviceDataResultSchema>;
export type UpdateUserPreferencesInput = z.infer<typeof updateUserPreferencesInputSchema>;
export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategoryInputSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionInputSchema>;
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;
export type BudgetUpsertInput = z.infer<typeof budgetUpsertInputSchema>;
export type MonthlyReport = z.infer<typeof monthlyReportSchema>;
export type AiPredictionRequest = z.infer<typeof aiPredictionRequestSchema>;
export type AiPredictionResponse = z.infer<typeof aiPredictionResponseSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
