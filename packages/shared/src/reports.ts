import type { Budget, Category, MonthlyReport, Transaction } from "./schema";

export function buildMonthlyReport(
  month: string,
  transactions: Transaction[],
  categories: Category[],
  budgets: Budget[],
): MonthlyReport {
  const monthTransactions = transactions.filter(
    (transaction) =>
      transaction.deletedAt === null &&
      transaction.kind === "expense" &&
      transaction.occurredAt.startsWith(month),
  );

  const expenseTotal = sumTransactions(monthTransactions);
  const budgetTotal = budgets.reduce((total, budget) => total + budget.amount, 0);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const budgetByCategory = new Map(
    budgets.map((budget) => [budget.categoryId ?? "__overall__", budget.amount]),
  );

  const byCategory = Array.from(
    monthTransactions
      .filter((transaction) => transaction.kind === "expense")
      .reduce((map, transaction) => {
        const current = map.get(transaction.categoryId) ?? 0;
        map.set(transaction.categoryId, current + transaction.amount);
        return map;
      }, new Map<string, number>()),
  )
    .map(([categoryId, total]) => {
      const category = categoryMap.get(categoryId);
      const budget = budgetByCategory.get(categoryId) ?? null;
      return {
        categoryId,
        categoryName: category?.name ?? "Uncategorized",
        total,
        budget,
        variance: budget === null ? null : budget - total,
      };
    })
    .sort((left, right) => right.total - left.total);

  return {
    month,
    expenseTotal,
    byCategory,
    budgetTotal,
    budgetRemaining: budgetTotal - expenseTotal,
  };
}

function sumTransactions(transactions: Transaction[]) {
  return transactions.reduce((total, transaction) => total + transaction.amount, 0);
}
