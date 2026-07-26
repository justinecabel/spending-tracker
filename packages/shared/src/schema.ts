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

export const debtReminderDaysSchema = z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(7)]);

export const debtSchema = z.object({
  id: z.string(),
  userId: z.string(),
  categoryId: z.string(),
  merchant: z.string(),
  amount: z.number().positive(),
  dueAt: z.string(),
  reminderDaysBefore: debtReminderDaysSchema.nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const countdownSchema = z.object({
  userId: z.string(),
  title: z.string(),
  targetAt: z.string(),
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
  importedDebts: z.number().int().nonnegative(),
  importedCountdown: z.boolean(),
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

export const createDebtInputSchema = z.object({
  categoryId: z.string().min(1).optional(),
  merchant: z.string().trim().min(1).max(140),
  amount: z.number().positive(),
  dueAt: z.string().datetime(),
  reminderDaysBefore: debtReminderDaysSchema.optional().nullable().default(null),
});

export const updateDebtInputSchema = createDebtInputSchema.partial().extend({
  paidAt: z.string().datetime().nullable().optional(),
});

export const countdownUpsertInputSchema = z.object({
  title: z.string().trim().min(1).max(140),
  targetAt: z.string().datetime(),
  createdAt: z.string().datetime().optional(),
});

export const notificationTestResultSchema = z.object({
  attempted: z.boolean(),
  permissionBefore: z.string(),
  permissionAfter: z.string(),
  deliveryMethod: z.enum(["service-worker", "notification-constructor", "none"]),
  error: z.string().max(500).nullable(),
});

export const clientDiagnosticInputSchema = z.object({
  kind: z.enum(["notification-diagnostic", "bug-report"]).default("notification-diagnostic"),
  client: z.record(z.unknown()),
  notificationTest: notificationTestResultSchema.optional().nullable().default(null),
  userText: z.string().trim().min(1).max(4_000).optional().nullable(),
})
  .refine((value) => value.kind !== "bug-report" || Boolean(value.userText), "Describe the bug before sending")
  .refine((value) => JSON.stringify(value).length <= 64_000, "Diagnostic report is too large");

export const clientDiagnosticResponseSchema = z.object({
  reportId: z.string(),
  receivedAt: z.string(),
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
export type Debt = z.infer<typeof debtSchema>;
export type Countdown = z.infer<typeof countdownSchema>;
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
export type CreateDebtInput = z.infer<typeof createDebtInputSchema>;
export type UpdateDebtInput = z.infer<typeof updateDebtInputSchema>;
export type CountdownUpsertInput = z.infer<typeof countdownUpsertInputSchema>;
export type NotificationTestResult = z.infer<typeof notificationTestResultSchema>;
export type ClientDiagnosticInput = z.infer<typeof clientDiagnosticInputSchema>;
export type ClientDiagnosticResponse = z.infer<typeof clientDiagnosticResponseSchema>;
export type MonthlyReport = z.infer<typeof monthlyReportSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
