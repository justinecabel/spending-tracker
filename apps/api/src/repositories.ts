import { nanoid } from "nanoid";
import {
  buildMonthlyReport,
  budgetUpsertInputSchema,
  createCategoryInputSchema,
  createTransactionInputSchema,
  importDeviceDataInputSchema,
  importDeviceDataResultSchema,
  ownDeviceDataInputSchema,
  ownDeviceDataResultSchema,
  type Budget,
  type BudgetUpsertInput,
  type Category,
  type CreateCategoryInput,
  type CreateTransactionInput,
  type ImportDeviceDataResult,
  monthlyReportQuerySchema,
  type MonthlyReport,
  type OwnDeviceDataResult,
  type Transaction,
  type User,
  transactionQuerySchema,
  updateCategoryInputSchema,
  updateTransactionInputSchema,
} from "@spending-tracker/shared";
import { db } from "./db/client";

export function getCategories(userId: string): Category[] {
  ensureSystemCategories(userId);
  const rows = db
    .prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY archived ASC, is_system ASC, sort_order ASC, name ASC")
    .all(userId) as CategoryRow[];
  return rows.map(mapCategory);
}

export function createCategory(userId: string, input: CreateCategoryInput): Category {
  ensureSystemCategories(userId);
  const parsed = createCategoryInputSchema.parse(input);
  assertCategoryNameAllowed(parsed.name);
  const now = new Date().toISOString();
  const row: CategoryRow = {
    id: nanoid(),
    user_id: userId,
    name: parsed.name,
    kind: parsed.kind,
    color: parsed.color,
    icon: parsed.icon,
    is_system: 0,
    sort_order: nextCategorySortOrder(userId),
    archived: 0,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `
      INSERT INTO categories (id, user_id, name, kind, color, icon, is_system, sort_order, archived, created_at, updated_at)
      VALUES (@id, @user_id, @name, @kind, @color, @icon, @is_system, @sort_order, @archived, @created_at, @updated_at)
    `,
  ).run(row);

  return mapCategory(row);
}

export function updateCategory(userId: string, categoryId: string, input: unknown): Category {
  ensureSystemCategories(userId);
  const parsed = updateCategoryInputSchema.parse(input);
  const current = db
    .prepare("SELECT * FROM categories WHERE id = ? AND user_id = ?")
    .get(categoryId, userId) as CategoryRow | undefined;

  if (!current) {
    throw new Error("Category not found");
  }
  if (current.is_system) {
    throw new Error("System categories cannot be changed");
  }
  if (parsed.name) {
    assertCategoryNameAllowed(parsed.name);
  }

  const updated: CategoryRow = {
    ...current,
    name: parsed.name ?? current.name,
    kind: parsed.kind ?? current.kind,
    color: parsed.color ?? current.color,
    icon: parsed.icon ?? current.icon,
    sort_order: parsed.sortOrder ?? current.sort_order,
    archived: parsed.archived === undefined ? current.archived : Number(parsed.archived),
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    `
      UPDATE categories
      SET name = @name, kind = @kind, color = @color, icon = @icon, sort_order = @sort_order, archived = @archived, updated_at = @updated_at
      WHERE id = @id AND user_id = @user_id
    `,
  ).run({
    id: updated.id,
    user_id: updated.user_id,
    name: updated.name,
    kind: updated.kind,
    color: updated.color,
    icon: updated.icon,
    sort_order: updated.sort_order,
    archived: updated.archived,
    updated_at: updated.updated_at,
  });

  return mapCategory(updated);
}

export function deleteCategory(userId: string, categoryId: string): Category {
  ensureSystemCategories(userId);
  const current = db
    .prepare("SELECT * FROM categories WHERE id = ? AND user_id = ?")
    .get(categoryId, userId) as CategoryRow | undefined;

  if (!current) {
    throw new Error("Category not found");
  }
  if (current.is_system) {
    throw new Error("System categories cannot be deleted");
  }

  const trashed = getSystemCategory(userId, "Trashed");
  if (!trashed) {
    throw new Error("Trashed category not available");
  }

  const updatedAt = new Date().toISOString();
  const archived: CategoryRow = {
    ...current,
    archived: 1,
    updated_at: updatedAt,
  };

  db.exec("BEGIN");
  try {
    db.prepare(
      `
        UPDATE transactions
        SET category_id = ?, updated_at = ?
        WHERE user_id = ? AND category_id = ?
      `,
    ).run(trashed.id, updatedAt, userId, current.id);

    db.prepare(
      `
        UPDATE categories
        SET archived = 1, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
    ).run(updatedAt, current.id, userId);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return mapCategory(archived);
}

export function getTransactions(userId: string, query: unknown): Transaction[] {
  const parsed = transactionQuerySchema.parse(query);
  let sql = "SELECT * FROM transactions WHERE user_id = @userId AND deleted_at IS NULL AND kind = 'expense'";
  const params: Record<string, string> = { userId };

  if (parsed.from) {
    sql += " AND occurred_at >= @from";
    params.from = parsed.from;
  }
  if (parsed.to) {
    sql += " AND occurred_at <= @to";
    params.to = parsed.to;
  }
  if (parsed.categoryId) {
    sql += " AND category_id = @categoryId";
    params.categoryId = parsed.categoryId;
  }
  if (parsed.kind === "expense") {
    sql += " AND kind = @kind";
    params.kind = parsed.kind;
  }
  if (parsed.search) {
    sql += " AND (merchant LIKE @search OR note LIKE @search)";
    params.search = `%${parsed.search}%`;
  }

  sql += " ORDER BY occurred_at DESC, created_at DESC";
  const rows = db.prepare(sql).all(params) as TransactionRow[];
  return rows.map(mapTransaction);
}

export function createTransaction(userId: string, input: unknown): Transaction {
  const parsed = createTransactionInputSchema.parse(input);
  const duplicate = parsed.clientId
    ? (db
        .prepare("SELECT * FROM transactions WHERE user_id = ? AND client_id = ?")
        .get(userId, parsed.clientId) as TransactionRow | undefined)
    : undefined;

  if (duplicate) {
    return mapTransaction(duplicate);
  }

  const now = new Date().toISOString();
  const row: TransactionRow = {
    id: nanoid(),
    user_id: userId,
    category_id: parsed.categoryId,
    amount: parsed.amount,
    kind: parsed.kind,
    occurred_at: parsed.occurredAt,
    note: parsed.note ?? null,
    merchant: parsed.merchant ?? null,
    client_id: parsed.clientId ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  db.prepare(
    `
      INSERT INTO transactions (id, user_id, category_id, amount, kind, occurred_at, note, merchant, client_id, created_at, updated_at, deleted_at)
      VALUES (@id, @user_id, @category_id, @amount, @kind, @occurred_at, @note, @merchant, @client_id, @created_at, @updated_at, @deleted_at)
    `,
  ).run(row);

  return mapTransaction(row);
}

export function updateTransaction(userId: string, transactionId: string, input: unknown): Transaction {
  const parsed = updateTransactionInputSchema.parse(input);
  const current = db
    .prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?")
    .get(transactionId, userId) as TransactionRow | undefined;

  if (!current || current.deleted_at) {
    throw new Error("Transaction not found");
  }

  const row: TransactionRow = {
    ...current,
    category_id: parsed.categoryId ?? current.category_id,
    amount: parsed.amount ?? current.amount,
    kind: parsed.kind ?? current.kind,
    occurred_at: parsed.occurredAt ?? current.occurred_at,
    note: parsed.note === undefined ? current.note : parsed.note,
    merchant: parsed.merchant === undefined ? current.merchant : parsed.merchant,
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    `
      UPDATE transactions
      SET category_id = @category_id, amount = @amount, kind = @kind, occurred_at = @occurred_at, note = @note, merchant = @merchant, updated_at = @updated_at
      WHERE id = @id AND user_id = @user_id
    `,
  ).run({
    id: row.id,
    user_id: row.user_id,
    category_id: row.category_id,
    amount: row.amount,
    kind: row.kind,
    occurred_at: row.occurred_at,
    note: row.note,
    merchant: row.merchant,
    updated_at: row.updated_at,
  });

  return mapTransaction(row);
}

export function deleteTransaction(userId: string, transactionId: string) {
  const deletedAt = new Date().toISOString();
  db.prepare(
    `
      UPDATE transactions
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `,
  ).run(deletedAt, deletedAt, transactionId, userId);
}

export function getBudgets(userId: string, month: string): Budget[] {
  monthlyReportQuerySchema.parse({ month });
  const rows = db
    .prepare("SELECT * FROM budgets WHERE user_id = ? AND month = ? ORDER BY category_id ASC")
    .all(userId, month) as BudgetRow[];
  return rows.map(mapBudget);
}

export function upsertBudget(userId: string, input: BudgetUpsertInput): Budget {
  const parsed = budgetUpsertInputSchema.parse(input);
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      "SELECT * FROM budgets WHERE user_id = ? AND month = ? AND IFNULL(category_id, '__overall__') = IFNULL(?, '__overall__')",
    )
    .get(userId, parsed.month, parsed.categoryId) as BudgetRow | undefined;

  const row: BudgetRow = existing
    ? {
        ...existing,
        amount: parsed.amount,
        updated_at: now,
      }
    : {
        id: nanoid(),
        user_id: userId,
        category_id: parsed.categoryId,
        month: parsed.month,
        amount: parsed.amount,
        rollover: 0,
        created_at: now,
        updated_at: now,
      };

  if (existing) {
    db.prepare(
      `
        UPDATE budgets
        SET amount = @amount, updated_at = @updated_at
        WHERE id = @id AND user_id = @user_id
      `,
    ).run(row);
  } else {
    db.prepare(
      `
        INSERT INTO budgets (id, user_id, category_id, month, amount, rollover, created_at, updated_at)
        VALUES (@id, @user_id, @category_id, @month, @amount, @rollover, @created_at, @updated_at)
      `,
    ).run(row);
  }

  return mapBudget(row);
}

export function getMonthlyReport(userId: string, month: string): MonthlyReport {
  const parsed = monthlyReportQuerySchema.parse({ month });
  const transactions = getTransactions(userId, {
    from: `${parsed.month}-01T00:00:00.000Z`,
    to: `${parsed.month}-31T23:59:59.999Z`,
  });
  const categories = getCategories(userId);
  const budgets = getBudgets(userId, parsed.month);
  return buildMonthlyReport(parsed.month, transactions, categories, budgets);
}

export function importDeviceData(
  targetUserId: string,
  input: { sourceUserId: string; deviceId: string },
): ImportDeviceDataResult {
  ensureSystemCategories(targetUserId);
  const parsed = importDeviceDataInputSchema.parse(input);
  const sourceUser = db.prepare("SELECT * FROM users WHERE id = ?").get(parsed.sourceUserId) as DatabaseUserRow | undefined;
  if (!sourceUser || !sourceUser.is_device_only || sourceUser.device_id !== parsed.deviceId) {
    throw new Error("Local Device-ID profile not found for import");
  }

  if (sourceUser.id === targetUserId) {
    throw new Error("Cannot import a profile into itself");
  }

  const sourceCategories = db
    .prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC")
    .all(sourceUser.id) as CategoryRow[];
  const targetCategories = db
    .prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC")
    .all(targetUserId) as CategoryRow[];
  const targetCategoryMap = new Map<string, CategoryRow>(
    targetCategories.map((category) => [`${category.kind}:${category.name.trim().toLowerCase()}`, category]),
  );

  const categoryIdMap = new Map<string, string>();
  let importedCategories = 0;

  for (const sourceCategory of sourceCategories) {
    const key = `${sourceCategory.kind}:${sourceCategory.name.trim().toLowerCase()}`;
    const existing = targetCategoryMap.get(key);
    if (existing) {
      categoryIdMap.set(sourceCategory.id, existing.id);
      continue;
    }

    const created = createCategory(targetUserId, {
      name: sourceCategory.name,
      kind: "expense",
      color: sourceCategory.color,
      icon: sourceCategory.icon,
    });
    importedCategories += 1;
    targetCategoryMap.set(key, {
      id: created.id,
      user_id: created.userId,
      name: created.name,
      kind: created.kind,
      color: created.color,
      icon: created.icon,
      is_system: Number(created.isSystem),
      sort_order: created.sortOrder,
      archived: Number(created.archived),
      created_at: created.createdAt,
      updated_at: created.updatedAt,
    });
    categoryIdMap.set(sourceCategory.id, created.id);
  }

  const sourceTransactions = db
    .prepare("SELECT * FROM transactions WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC")
    .all(sourceUser.id) as TransactionRow[];
  let importedTransactions = 0;
  const fallbackCategory = getSystemCategory(targetUserId, "Other");

  for (const transaction of sourceTransactions) {
    const duplicateClientId = `import:${sourceUser.id}:${transaction.id}`;
    const existing = db
      .prepare("SELECT id FROM transactions WHERE user_id = ? AND client_id = ?")
      .get(targetUserId, duplicateClientId) as { id: string } | undefined;
    if (existing) {
      continue;
    }

    createTransaction(targetUserId, {
      categoryId: categoryIdMap.get(transaction.category_id) ?? fallbackCategory?.id ?? targetCategories[0]?.id ?? transaction.category_id,
      amount: transaction.amount,
      kind: "expense",
      occurredAt: transaction.occurred_at,
      note: transaction.note,
      merchant: transaction.merchant,
      clientId: duplicateClientId,
    });
    importedTransactions += 1;
  }

  const sourceBudgets = db.prepare("SELECT * FROM budgets WHERE user_id = ?").all(sourceUser.id) as BudgetRow[];
  let importedBudgets = 0;

  for (const budget of sourceBudgets) {
    upsertBudget(targetUserId, {
      categoryId: budget.category_id ? categoryIdMap.get(budget.category_id) ?? null : null,
      month: budget.month,
      amount: budget.amount,
    });
    importedBudgets += 1;
  }

  return importDeviceDataResultSchema.parse({
    importedCategories,
    importedTransactions,
    importedBudgets,
  });
}

export function ownDeviceData(
  sourceUserId: string,
  input: { deviceId: string },
): OwnDeviceDataResult {
  const parsed = ownDeviceDataInputSchema.parse(input);
  const sourceUser = db.prepare("SELECT * FROM users WHERE id = ?").get(sourceUserId) as DatabaseUserRow | undefined;
  if (!sourceUser) {
    throw new Error("Source account not found");
  }

  const targetDeviceUser = db
    .prepare("SELECT * FROM users WHERE device_id = ? AND is_device_only = 1")
    .get(parsed.deviceId) as DatabaseUserRow | undefined;
  if (!targetDeviceUser) {
    throw new Error("Local Device-ID profile not found for this device");
  }

  if (targetDeviceUser.id === sourceUser.id) {
    throw new Error("Cannot own the same profile");
  }

  const sourceCategories = db
    .prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC")
    .all(sourceUser.id) as CategoryRow[];
  const sourceTransactions = db
    .prepare("SELECT * FROM transactions WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC")
    .all(sourceUser.id) as TransactionRow[];
  const sourceBudgets = db
    .prepare("SELECT * FROM budgets WHERE user_id = ? ORDER BY month ASC, category_id ASC")
    .all(sourceUser.id) as BudgetRow[];
  const now = new Date().toISOString();
  const categoryIdMap = new Map<string, string>();

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM transactions WHERE user_id = ?").run(targetDeviceUser.id);
    db.prepare("DELETE FROM budgets WHERE user_id = ?").run(targetDeviceUser.id);
    db.prepare("DELETE FROM categories WHERE user_id = ?").run(targetDeviceUser.id);
    db.prepare("UPDATE users SET currency = ?, updated_at = ? WHERE id = ?").run(sourceUser.currency, now, targetDeviceUser.id);

    for (const sourceCategory of sourceCategories) {
      const nextId = nanoid();
      categoryIdMap.set(sourceCategory.id, nextId);
      db.prepare(
        `
          INSERT INTO categories (id, user_id, name, kind, color, icon, is_system, sort_order, archived, created_at, updated_at)
          VALUES (@id, @user_id, @name, @kind, @color, @icon, @is_system, @sort_order, @archived, @created_at, @updated_at)
        `,
      ).run({
        id: nextId,
        user_id: targetDeviceUser.id,
        name: sourceCategory.name,
        kind: sourceCategory.kind,
        color: sourceCategory.color,
        icon: sourceCategory.icon,
        is_system: sourceCategory.is_system,
        sort_order: sourceCategory.sort_order,
        archived: sourceCategory.archived,
        created_at: sourceCategory.created_at,
        updated_at: now,
      });
    }

    for (const sourceTransaction of sourceTransactions) {
      db.prepare(
        `
          INSERT INTO transactions (id, user_id, category_id, amount, kind, occurred_at, note, merchant, client_id, created_at, updated_at, deleted_at)
          VALUES (@id, @user_id, @category_id, @amount, @kind, @occurred_at, @note, @merchant, @client_id, @created_at, @updated_at, @deleted_at)
        `,
      ).run({
        id: nanoid(),
        user_id: targetDeviceUser.id,
        category_id: categoryIdMap.get(sourceTransaction.category_id) ?? null,
        amount: sourceTransaction.amount,
        kind: sourceTransaction.kind,
        occurred_at: sourceTransaction.occurred_at,
        note: sourceTransaction.note,
        merchant: sourceTransaction.merchant,
        client_id: `owned:${sourceUser.id}:${sourceTransaction.id}`,
        created_at: sourceTransaction.created_at,
        updated_at: now,
        deleted_at: null,
      });
    }

    for (const sourceBudget of sourceBudgets) {
      db.prepare(
        `
          INSERT INTO budgets (id, user_id, category_id, month, amount, rollover, created_at, updated_at)
          VALUES (@id, @user_id, @category_id, @month, @amount, @rollover, @created_at, @updated_at)
        `,
      ).run({
        id: nanoid(),
        user_id: targetDeviceUser.id,
        category_id: sourceBudget.category_id ? categoryIdMap.get(sourceBudget.category_id) ?? null : null,
        month: sourceBudget.month,
        amount: sourceBudget.amount,
        rollover: sourceBudget.rollover,
        created_at: sourceBudget.created_at,
        updated_at: now,
      });
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const refreshedDeviceUser = db.prepare("SELECT * FROM users WHERE id = ?").get(targetDeviceUser.id) as DatabaseUserRow | undefined;
  if (!refreshedDeviceUser) {
    throw new Error("Local Device-ID profile could not be refreshed");
  }

  return ownDeviceDataResultSchema.parse({
    importedCategories: sourceCategories.length,
    importedTransactions: sourceTransactions.length,
    importedBudgets: sourceBudgets.length,
    deviceUser: mapUser(refreshedDeviceUser),
  });
}

function nextCategorySortOrder(userId: string) {
  const result = db.prepare("SELECT COALESCE(MAX(sort_order), -1) as maxSort FROM categories WHERE user_id = ?").get(userId) as {
    maxSort: number;
  };
  return result.maxSort + 1;
}

function ensureSystemCategories(userId: string) {
  const now = new Date().toISOString();
  const systemCategories = [
    { name: "Other", color: "#475569", icon: "circle", sortOrder: 98 },
    { name: "Trashed", color: "#991B1B", icon: "archive", sortOrder: 99 },
  ];

  for (const category of systemCategories) {
    db.prepare(
      `
        INSERT INTO categories (id, user_id, name, kind, color, icon, is_system, sort_order, archived, created_at, updated_at)
        SELECT @id, @userId, @name, 'expense', @color, @icon, 1, @sortOrder, 0, @createdAt, @updatedAt
        WHERE NOT EXISTS (
          SELECT 1 FROM categories WHERE user_id = @userId AND LOWER(name) = LOWER(@name)
        )
      `,
    ).run({
      id: nanoid(),
      userId,
      name: category.name,
      color: category.color,
      icon: category.icon,
      sortOrder: category.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  }

  db.prepare(
    `
      UPDATE categories
      SET is_system = 1
      WHERE user_id = ? AND LOWER(name) IN ('other', 'trashed')
    `,
  ).run(userId);
}

function getSystemCategory(userId: string, name: "Other" | "Trashed") {
  return db
    .prepare("SELECT * FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1")
    .get(userId, name) as CategoryRow | undefined;
}

function assertCategoryNameAllowed(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "other" || normalized === "trashed") {
    throw new Error("This category name is reserved");
  }
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    icon: row.icon,
    isSystem: Boolean(row.is_system),
    sortOrder: row.sort_order,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    amount: row.amount,
    kind: row.kind,
    occurredAt: row.occurred_at,
    note: row.note,
    merchant: row.merchant,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    month: row.month,
    amount: row.amount,
    rollover: Boolean(row.rollover),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUser(row: DatabaseUserRow): User {
  return {
    id: row.id,
    email: row.is_device_only ? null : row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    googleSub: row.is_device_only ? null : row.google_sub,
    deviceId: row.device_id,
    isDeviceOnly: Boolean(row.is_device_only),
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type CategoryRow = {
  id: string;
  user_id: string;
  name: string;
  kind: "expense" | "income";
  color: string;
  icon: string;
  is_system: number;
  sort_order: number;
  archived: number;
  created_at: string;
  updated_at: string;
};

type DatabaseUserRow = {
  id: string;
  email: string | null;
  name: string;
  avatar_url: string | null;
  google_sub: string | null;
  device_id: string | null;
  sync_code: string | null;
  is_device_only: number;
  currency: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type TransactionRow = {
  id: string;
  user_id: string;
  category_id: string;
  amount: number;
  kind: "expense" | "income";
  occurred_at: string;
  note: string | null;
  merchant: string | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type BudgetRow = {
  id: string;
  user_id: string;
  category_id: string | null;
  month: string;
  amount: number;
  rollover: number;
  created_at: string;
  updated_at: string;
};
