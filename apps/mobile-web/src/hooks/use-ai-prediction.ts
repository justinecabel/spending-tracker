import { useQuery } from "@tanstack/react-query";
import type { AiPredictionRequest, AiPredictionResponse, Category, Transaction } from "@spending-tracker/shared";
import { api } from "../lib/api";
import type { ResolvedSummaryRange } from "../lib/summary-range";
import { offlineCacheStore } from "../state/offline-cache";

type UseAiPredictionInput = {
  userId: string;
  currency: string;
  range: ResolvedSummaryRange;
  transactions: Transaction[];
  categories: Category[];
};

export function useAiPrediction({ userId, currency, range, transactions, categories }: UseAiPredictionInput) {
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const allTransactions = Array.from(new Map(transactions.map((transaction) => [transaction.id, transaction])).values())
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  const forecastDates = buildForecastDates(range);
  const modelTransactions = selectModelTransactions(allTransactions, 80);
  const instruction = `Forecast spending for ${range.title} using the supplied history and habits. Predict the total by the end of the cycle, the total for each category, and a possible spending amount at each future forecast date. Use dates, merchants, notes, recurring patterns, weekday patterns, and category history. Use every supplied transaction below, do not invent events, and return only the requested JSON object with no explanation.`;
  const input: AiPredictionRequest = {
    instruction,
    range: {
      title: range.title,
      from: range.from ?? null,
      to: range.to ?? null,
      forecastTo: range.forecastTo ?? null,
    },
    currency,
    categoryNames: Array.from(new Set([
      ...categories.map((category) => category.name),
      ...modelTransactions.map((transaction) => categoryMap.get(transaction.categoryId) ?? "Uncategorized"),
    ])).slice(0, 20),
    forecastDates,
    transactions: modelTransactions.map((transaction) => ({
      amount: transaction.amount,
      occurredAt: transaction.occurredAt,
      category: categoryMap.get(transaction.categoryId) ?? "Uncategorized",
      merchant: transaction.merchant,
      note: transaction.note,
    })),
  };
  const dataSignature = buildAiPredictionDataSignature(currency, allTransactions, categories);
  const cacheKey = `ai-prediction-data-v18:${userId}:${range.key}:${dataSignature}`;
  const minimumObservedTotal = allTransactions.reduce((total, transaction) => {
    const occurredAt = new Date(transaction.occurredAt).getTime();
    const from = range.from ? new Date(range.from).getTime() : Number.NEGATIVE_INFINITY;
    const to = Math.min(range.to ? new Date(range.to).getTime() : Date.now(), Date.now());
    return occurredAt >= from && occurredAt <= to ? total + transaction.amount : total;
  }, 0);
  const cachedPrediction = offlineCacheStore((state) => state.aiPredictionByKey[cacheKey]);
  const safeCachedPrediction = cachedPrediction === undefined ? undefined : withObservedMinimum(cachedPrediction, minimumObservedTotal);
  const predictionCacheHydrated = offlineCacheStore((state) => state.aiPredictionHydrated);

  return useQuery<AiPredictionResponse>({
    queryKey: ["ai-prediction-data-v18", userId, range.key, dataSignature],
    queryFn: async () => {
      const persistedPrediction = offlineCacheStore.getState().aiPredictionByKey[cacheKey];
      if (persistedPrediction !== undefined) {
        return withObservedMinimum(persistedPrediction, minimumObservedTotal);
      }
      const prediction = await api.aiPrediction(input);
      const safePrediction = withObservedMinimum(prediction, minimumObservedTotal);
      offlineCacheStore.getState().setAiPrediction(cacheKey, safePrediction);
      return safePrediction;
    },
    initialData: safeCachedPrediction,
    enabled: predictionCacheHydrated && userId !== "anonymous" && allTransactions.length > 0,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function buildAiPredictionDataSignature(currency: string, transactions: Transaction[], categories: Category[]) {
  const transactionSignature = transactions.map((transaction) => `${transaction.id}:${transaction.updatedAt}`).join(",");
  const categorySignature = categories.map((category) => `${category.id}:${category.updatedAt}:${category.name}`).sort().join(",");
  return `${currency}:${transactionSignature}:${categorySignature}`;
}

function selectModelTransactions(transactions: Transaction[], limit: number) {
  if (transactions.length <= limit) {
    return transactions;
  }

  const recentCount = Math.min(200, Math.ceil(limit * 0.67));
  const recent = transactions.slice(0, recentCount);
  const history = transactions.slice(recentCount);
  const historyCount = limit - recent.length;
  const step = Math.max(1, Math.floor(history.length / historyCount));
  const sampledHistory = Array.from({ length: historyCount }, (_, index) => history[Math.min(index * step, history.length - 1)]);

  return Array.from(new Map([...recent, ...sampledHistory].map((transaction) => [transaction.id, transaction])).values());
}

function withObservedMinimum(prediction: AiPredictionResponse, minimumObservedTotal: number): AiPredictionResponse {
  return {
    ...prediction,
    projectedTotal: Math.max(prediction.projectedTotal, minimumObservedTotal),
  };
}

function buildForecastDates(range: ResolvedSummaryRange) {
  const start = new Date(range.to ?? new Date());
  const end = new Date(range.forecastTo ?? start);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return [];
  }

  const durationDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  const dates: string[] = [];
  const cursor = new Date(start);
  if (durationDays <= 62) {
    cursor.setDate(cursor.getDate() + 1);
    while (cursor <= end && dates.length < 62) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  if (durationDays <= 730) {
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() + 1);
    while (cursor <= end && dates.length < 62) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return dates;
  }

  cursor.setMonth(0, 1);
  cursor.setFullYear(cursor.getFullYear() + 1);
  while (cursor <= end && dates.length < 20) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setFullYear(cursor.getFullYear() + 1);
  }
  return dates;
}
