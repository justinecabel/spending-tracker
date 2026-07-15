import type { Budget, Category, Transaction } from "./schema";

export type ForecastRangeInput = {
  title: string;
  from?: string;
  to?: string;
  forecastTo?: string;
};

export type ForecastAnalysisInput = {
  transactions: Transaction[];
  historyTransactions?: Transaction[];
  categories: Category[];
  budgets?: Budget[];
  range: ForecastRangeInput;
  now?: Date | string;
};

export type ForecastConfidenceLabel = "Low" | "Medium" | "High";

export type ForecastPoint = {
  date: string;
  label: string;
  actual: number | null;
  projected: number;
  low: number;
  high: number;
};

export type RecurringPattern = {
  label: string;
  categoryId: string | null;
  merchant: string | null;
  cadence: "Weekly" | "Monthly";
  intervalDays: number;
  expectedAmount: number;
  nextDate: string | null;
  expectedOccurrences: number;
  projectedTotal: number;
  confidence: number;
};

export type CategoryForecast = {
  categoryId: string | null;
  categoryName: string;
  actual: number;
  projected: number;
  budget: number | null;
  variance: number | null;
  share: number;
};

export type BudgetComparison = {
  budget: number | null;
  actual: number;
  projected: number;
  variance: number | null;
  remainingDaily: number | null;
};

export type ForecastAnalysis = {
  actualTotal: number;
  projectedTotal: number;
  forecastLow: number;
  forecastHigh: number;
  confidence: number;
  confidenceLabel: ForecastConfidenceLabel;
  confidenceReasons: string[];
  futureDays: number;
  observedDays: number;
  activeDays: number;
  transactionCount: number;
  points: ForecastPoint[];
  categories: CategoryForecast[];
  recurring: RecurringPattern[];
  budget: BudgetComparison;
  topMerchants: Array<{ merchant: string; total: number; share: number }>;
  weekdayTotals: Array<{ weekday: number; label: string; total: number; average: number }>;
  hourlyTotals: Array<{ hour: number; label: string; total: number }>;
  recentSevenDayTotal: number;
  previousSevenDayTotal: number;
  recentSevenDayDelta: number;
  unusualTransactions: Array<{ id: string; label: string; amount: number; occurredAt: string; reason: string }>;
  dataQualityNotes: string[];
};

type DayBucket = {
  key: string;
  date: Date;
  amount: number;
};

const DAY_MS = 86_400_000;
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildForecastAnalysis(input: ForecastAnalysisInput): ForecastAnalysis {
  const now = startOfDay(asDate(input.now ?? new Date()));
  const allTransactions = uniqueTransactions([...(input.transactions ?? []), ...(input.historyTransactions ?? [])])
    .filter(isExpense)
    .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
  const earliest = allTransactions.length ? startOfDay(new Date(allTransactions[0]!.occurredAt)) : now;
  const periodStart = startOfDay(input.range.from ? asDate(input.range.from) : earliest);
  const requestedForecastEnd = input.range.forecastTo
    ? endOfDay(asDate(input.range.forecastTo))
    : input.range.to
      ? endOfDay(asDate(input.range.to))
      : endOfDay(now);
  const forecastEnd = requestedForecastEnd < periodStart ? periodStart : requestedForecastEnd;
  const requestedObservedEnd = input.range.to ? endOfDay(asDate(input.range.to)) : endOfDay(now);
  const observedEnd = minDate(endOfDay(now), requestedObservedEnd, forecastEnd);
  const actualTransactions = allTransactions.filter((transaction) => {
    const date = new Date(transaction.occurredAt);
    return date >= periodStart && date <= observedEnd;
  });
  const actualTotal = sum(actualTransactions.map((transaction) => transaction.amount));
  const observedDays = Math.max(1, daysBetween(periodStart, observedEnd));
  const futureDates = listDates(addDays(observedEnd, 1), startOfDay(forecastEnd));
  const futureDays = futureDates.length;
  const baselineStart = addDays(observedEnd, -89);
  const baselineTransactions = allTransactions.filter((transaction) => {
    const date = new Date(transaction.occurredAt);
    return date >= baselineStart && date <= observedEnd;
  });
  const dayBuckets = listDates(baselineStart, observedEnd).map((date) => ({
    key: dateKey(date),
    date,
    amount: 0,
  }));
  const dayIndex = new Map(dayBuckets.map((bucket, index) => [bucket.key, index]));
  for (const transaction of baselineTransactions) {
    const index = dayIndex.get(dateKey(new Date(transaction.occurredAt)));
    if (index !== undefined) {
      dayBuckets[index]!.amount += transaction.amount;
    }
  }

  const rawDailyValues = dayBuckets.map((bucket) => bucket.amount);
  const cap = robustCap(rawDailyValues);
  const dailyValues = rawDailyValues.map((amount) => Math.min(amount, cap));
  const totalBaseline = sum(dailyValues);
  const activeDays = dailyValues.filter((amount) => amount > 0).length;
  const calendarRate = totalBaseline / Math.max(dayBuckets.length, 1);
  const activeDayRate = activeDays ? totalBaseline / activeDays : 0;
  const activityProbability = activeDays / Math.max(dayBuckets.length, 1);
  const robustRate = activeDayRate * activityProbability;
  const recentRate = exponentiallyWeightedRate(dailyValues);
  const weekdayRates = buildWeekdayRates(dayBuckets, dailyValues, robustRate);
  const weekdayFutureRate = futureDays
    ? sum(futureDates.map((date) => weekdayRates[date.getDay()] ?? robustRate)) / futureDays
    : robustRate;
  const recurrencePatterns = detectRecurringPatterns(allTransactions, input.categories, observedEnd, forecastEnd);
  const recurringRate = futureDays
    ? sum(recurrencePatterns.map((pattern) => pattern.projectedTotal)) / futureDays
    : 0;
  const transactionCount = allTransactions.length;
  const dataTier = transactionCount < 14 ? "sparse" : activeDays < 14 ? "moderate" : "strong";
  const recurrenceWeight = recurrencePatterns.length && dataTier === "strong" ? 0.15 : 0;
  const baseWeight = dataTier === "sparse" ? 0.7 : dataTier === "moderate" ? 0.55 : 0.4;
  const historicalWeight = dataTier === "sparse" ? 0.3 : dataTier === "moderate" ? 0.25 : 0.2;
  const weekdayWeight = 1 - baseWeight - historicalWeight - recurrenceWeight;
  const blendedRate = Math.max(
    0,
    recentRate * baseWeight +
      robustRate * historicalWeight +
      weekdayFutureRate * weekdayWeight +
      recurringRate * recurrenceWeight,
  );
  const trendMultiplier = cappedTrendMultiplier(dayBuckets);
  const futureDailyRates = futureDates.map((date) => {
    const weekdayRatio = robustRate > 0 ? clamp((weekdayRates[date.getDay()] ?? robustRate) / robustRate, 0.55, 1.8) : 1;
    return Math.max(0, blendedRate * trendMultiplier * weekdayRatio);
  });
  const futureTotal = sum(futureDailyRates);
  const projectedTotal = actualTotal + futureTotal;
  const confidence = calculateConfidence(transactionCount, activeDays, dayBuckets.length, recurrencePatterns, dailyValues);
  const confidenceLabel: ForecastConfidenceLabel = confidence >= 0.75 ? "High" : confidence >= 0.5 ? "Medium" : "Low";
  const volatility = standardDeviation(dailyValues);
  const uncertainty = futureDays
    ? 1.28 * volatility * Math.sqrt(futureDays) * (1 + (1 - confidence) * 0.75)
    : 0;
  const forecastLow = Math.max(actualTotal, projectedTotal - uncertainty);
  const forecastHigh = projectedTotal + uncertainty;
  const categories = buildCategoryForecasts(actualTransactions, allTransactions, input.categories, input.budgets ?? [], periodStart, forecastEnd, futureTotal);
  const budget = buildBudgetComparison(actualTotal, projectedTotal, input.budgets ?? [], periodStart, forecastEnd, futureDays);
  const points = buildForecastPoints(periodStart, forecastEnd, observedEnd, actualTransactions, futureDates, futureDailyRates, volatility, confidence);
  const confidenceReasons = buildConfidenceReasons(transactionCount, activeDays, dayBuckets.length, recurrencePatterns, volatility, confidenceLabel);
  const dataQualityNotes = buildDataQualityNotes(allTransactions, actualTransactions, input.categories, transactionCount, volatility);
  const topMerchants = buildTopMerchants(actualTransactions);
  const weekdayTotals = buildWeekdayTotals(actualTransactions);
  const hourlyTotals = buildHourlyTotals(actualTransactions);
  const recentSevenDayTotal = sumForWindow(allTransactions, addDays(observedEnd, -6), observedEnd);
  const previousSevenDayTotal = sumForWindow(allTransactions, addDays(observedEnd, -13), addDays(observedEnd, -7));
  const recentSevenDayDelta = previousSevenDayTotal ? recentSevenDayTotal / previousSevenDayTotal - 1 : 0;
  const unusualTransactions = buildUnusualTransactions(actualTransactions, cap, input.categories);

  return {
    actualTotal,
    projectedTotal,
    forecastLow,
    forecastHigh,
    confidence,
    confidenceLabel,
    confidenceReasons,
    futureDays,
    observedDays,
    activeDays,
    transactionCount,
    points,
    categories,
    recurring: recurrencePatterns,
    budget,
    topMerchants,
    weekdayTotals,
    hourlyTotals,
    recentSevenDayTotal,
    previousSevenDayTotal,
    recentSevenDayDelta,
    unusualTransactions,
    dataQualityNotes,
  };
}

function buildForecastPoints(
  periodStart: Date,
  forecastEnd: Date,
  observedEnd: Date,
  actualTransactions: Transaction[],
  futureDates: Date[],
  futureDailyRates: number[],
  volatility: number,
  confidence: number,
): ForecastPoint[] {
  const actualByDate = new Map<string, number>();
  for (const transaction of actualTransactions) {
    const key = dateKey(new Date(transaction.occurredAt));
    actualByDate.set(key, (actualByDate.get(key) ?? 0) + transaction.amount);
  }
  const futureIndex = new Map(futureDates.map((date, index) => [dateKey(date), index]));
  const dailyUncertainty = 1.28 * volatility * (1 + (1 - confidence) * 0.75);
  return listDates(periodStart, forecastEnd).map((date) => {
    const key = dateKey(date);
    const actual = date <= observedEnd ? actualByDate.get(key) ?? 0 : null;
    const futureAmount = futureIndex.has(key) ? futureDailyRates[futureIndex.get(key)!] ?? 0 : 0;
    const projected = actual ?? futureAmount;
    return {
      date: key,
      label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
      actual,
      projected,
      low: actual ?? Math.max(0, futureAmount - dailyUncertainty),
      high: actual ?? futureAmount + dailyUncertainty,
    };
  });
}

function buildCategoryForecasts(
  actualTransactions: Transaction[],
  allTransactions: Transaction[],
  categories: Category[],
  budgets: Budget[],
  periodStart: Date,
  forecastEnd: Date,
  futureTotal: number,
): CategoryForecast[] {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const recentStart = addDays(forecastEnd, -89);
  const historyTotals = new Map<string, number>();
  for (const transaction of allTransactions) {
    const date = new Date(transaction.occurredAt);
    if (date >= recentStart && date <= forecastEnd) {
      historyTotals.set(transaction.categoryId, (historyTotals.get(transaction.categoryId) ?? 0) + transaction.amount);
    }
  }
  const historyTotal = sum(Array.from(historyTotals.values()));
  const actualTotals = new Map<string, number>();
  for (const transaction of actualTransactions) {
    actualTotals.set(transaction.categoryId, (actualTotals.get(transaction.categoryId) ?? 0) + transaction.amount);
  }
  const keys = new Set([...historyTotals.keys(), ...actualTotals.keys()]);
  return Array.from(keys)
    .map((categoryId) => {
      const share = historyTotal ? (historyTotals.get(categoryId) ?? 0) / historyTotal : 0;
      const projected = (actualTotals.get(categoryId) ?? 0) + futureTotal * share;
      const budget = budgetForCategory(budgets, categoryId, periodStart, forecastEnd);
      return {
        categoryId,
        categoryName: categoryMap.get(categoryId)?.name ?? "Uncategorized",
        actual: actualTotals.get(categoryId) ?? 0,
        projected,
        budget,
        variance: budget === null ? null : budget - projected,
        share: futureTotal ? (futureTotal * share) / futureTotal : 0,
      };
    })
    .sort((left, right) => right.projected - left.projected);
}

function buildBudgetComparison(actual: number, projected: number, budgets: Budget[], start: Date, end: Date, futureDays: number): BudgetComparison {
  const budget = budgetForCategory(budgets, null, start, end);
  return {
    budget,
    actual,
    projected,
    variance: budget === null ? null : budget - projected,
    remainingDaily: budget === null || futureDays === 0 ? null : Math.max(0, budget - actual) / futureDays,
  };
}

function budgetForCategory(budgets: Budget[], categoryId: string | null, start: Date, end: Date) {
  const relevant = budgets.filter((budget) => (budget.categoryId ?? null) === categoryId);
  if (relevant.length === 0) return null;
  return relevant.reduce((total, budget) => {
    const monthStart = new Date(`${budget.month}-01T00:00:00`);
    const monthEnd = endOfMonth(monthStart);
    const overlapStart = maxDate(start, monthStart);
    const overlapEnd = minDate(end, monthEnd);
    if (overlapEnd < overlapStart) return total;
    const overlapDays = daysBetween(overlapStart, overlapEnd);
    const monthDays = daysBetween(monthStart, monthEnd);
    return total + budget.amount * overlapDays / monthDays;
  }, 0);
}

function detectRecurringPatterns(transactions: Transaction[], categories: Category[], observedEnd: Date, forecastEnd: Date): RecurringPattern[] {
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const lookbackStart = addDays(observedEnd, -365);
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const date = new Date(transaction.occurredAt);
    if (date < lookbackStart || date > observedEnd) continue;
    const merchant = normalizeMerchant(transaction.merchant);
    const key = merchant ? `merchant:${merchant}:${transaction.categoryId}` : `category:${transaction.categoryId}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }
  return Array.from(groups.values())
    .map((events): RecurringPattern | null => {
      const sorted = events.slice().sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
      if (sorted.length < 3) return null;
      const dates = sorted.map((event) => startOfDay(new Date(event.occurredAt)));
      const intervals = dates.slice(1).map((date, index) => Math.max(1, Math.round((date.getTime() - dates[index]!.getTime()) / DAY_MS)));
      const intervalDays = Math.round(median(intervals));
      const cadence = intervalDays >= 5 && intervalDays <= 9 ? "Weekly" : intervalDays >= 20 && intervalDays <= 45 ? "Monthly" : null;
      if (!cadence) return null;
      const intervalConsistency = consistency(intervals, intervalDays);
      const amounts = sorted.map((event) => event.amount);
      const amountMedian = median(amounts);
      const amountConsistency = consistency(amounts, amountMedian);
      if (intervalConsistency < 0.55 || amountConsistency < 0.55) return null;
      const lastDate = dates[dates.length - 1]!;
      let nextDate = addDays(lastDate, intervalDays);
      let expectedOccurrences = 0;
      while (nextDate <= forecastEnd) {
        if (nextDate > observedEnd) expectedOccurrences += 1;
        nextDate = addDays(nextDate, intervalDays);
      }
      const merchant = normalizeMerchant(sorted[0]!.merchant);
      const categoryId = sorted[0]!.categoryId || null;
      const label = merchant ? sorted[0]!.merchant!.trim() : categoryMap.get(categoryId ?? "") ?? "Uncategorized";
      return {
        label,
        categoryId,
        merchant: merchant ? sorted[0]!.merchant!.trim() : null,
        cadence,
        intervalDays,
        expectedAmount: amountMedian,
        nextDate: expectedOccurrences ? dateKey(addDays(lastDate, intervalDays)) : null,
        expectedOccurrences,
        projectedTotal: amountMedian * expectedOccurrences,
        confidence: (intervalConsistency + amountConsistency) / 2,
      } satisfies RecurringPattern;
    })
    .filter((pattern): pattern is RecurringPattern => pattern !== null && pattern.expectedOccurrences > 0)
    .sort((left, right) => right.projectedTotal - left.projectedTotal)
    .slice(0, 5);
}

function buildTopMerchants(transactions: Transaction[]) {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    const merchant = transaction.merchant?.trim();
    if (merchant) totals.set(merchant, (totals.get(merchant) ?? 0) + transaction.amount);
  }
  const total = sum(transactions.map((transaction) => transaction.amount)) || 1;
  return Array.from(totals.entries())
    .map(([merchant, amount]) => ({ merchant, total: amount, share: amount / total }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 5);
}

function buildWeekdayTotals(transactions: Transaction[]) {
  const totals = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const transaction of transactions) {
    const bucket = totals[new Date(transaction.occurredAt).getDay()]!;
    bucket.total += transaction.amount;
    bucket.count += 1;
  }
  return totals.map((bucket, weekday) => ({ weekday, label: WEEKDAY_LABELS[weekday]!, total: bucket.total, average: bucket.count ? bucket.total / bucket.count : 0 }));
}

function buildHourlyTotals(transactions: Transaction[]) {
  const totals = Array.from({ length: 24 }, () => 0);
  for (const transaction of transactions) totals[new Date(transaction.occurredAt).getHours()] += transaction.amount;
  return totals.map((total, hour) => ({ hour, label: formatHour(hour), total })).filter((bucket) => bucket.total > 0);
}

function buildUnusualTransactions(transactions: Transaction[], cap: number, categories: Category[]) {
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  return transactions
    .filter((transaction) => transaction.amount > cap)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5)
    .map((transaction) => ({
      id: transaction.id,
      label: transaction.merchant?.trim() || categoryMap.get(transaction.categoryId) || "Uncategorized",
      amount: transaction.amount,
      occurredAt: transaction.occurredAt,
      reason: "Higher than the robust daily spending threshold",
    }));
}

function buildConfidenceReasons(transactionCount: number, activeDays: number, windowDays: number, recurring: RecurringPattern[], volatility: number, label: ForecastConfidenceLabel) {
  const reasons = [`${label} confidence from ${transactionCount} transactions across ${activeDays} active days`];
  if (windowDays > 0 && activeDays / windowDays < 0.2) reasons.push("Spending happens on relatively few days");
  if (recurring.length) reasons.push(`${recurring.length} recurring pattern${recurring.length === 1 ? "" : "s"} detected`);
  if (volatility > 0) reasons.push("Daily variation is included in the forecast range");
  return reasons;
}

function buildDataQualityNotes(allTransactions: Transaction[], actualTransactions: Transaction[], categories: Category[], transactionCount: number, volatility: number) {
  const notes: string[] = [];
  if (transactionCount < 14) notes.push("Limited history; the forecast uses a conservative baseline");
  const actualAmounts = actualTransactions.map((transaction) => transaction.amount);
  const allAmounts = allTransactions.map((transaction) => transaction.amount);
  const referenceMedian = median(allAmounts);
  const largestAmount = Math.max(...allAmounts, 0);
  if (volatility > (sum(actualAmounts) / Math.max(actualAmounts.length, 1)) * 1.5 || (referenceMedian > 0 && largestAmount > referenceMedian * 3)) {
    notes.push("High spending variation widens the forecast range");
  }
  const missingMerchantShare = actualTransactions.length ? actualTransactions.filter((transaction) => !transaction.merchant?.trim()).length / actualTransactions.length : 0;
  if (missingMerchantShare > 0.5) notes.push("Many transactions have no merchant details");
  const categoryIds = new Set(categories.map((category) => category.id));
  if (actualTransactions.some((transaction) => !categoryIds.has(transaction.categoryId))) notes.push("Some transactions use an unavailable category");
  if (allTransactions.length === 0) notes.push("Add transactions to build a personal spending baseline");
  return notes;
}

function buildWeekdayRates(buckets: DayBucket[], values: number[], fallback: number) {
  const totals = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  buckets.forEach((bucket, index) => {
    const weekday = bucket.date.getDay();
    totals[weekday]!.total += values[index] ?? 0;
    totals[weekday]!.count += 1;
  });
  return totals.map((bucket) => {
    const shrink = bucket.count / (bucket.count + 4);
    const observed = bucket.count ? bucket.total / bucket.count : fallback;
    return observed * shrink + fallback * (1 - shrink);
  });
}

function exponentiallyWeightedRate(values: number[]) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (let index = 0; index < values.length; index += 1) {
    const age = values.length - index - 1;
    const weight = Math.exp(-Math.log(2) * age / 21);
    weightedTotal += (values[index] ?? 0) * weight;
    weightTotal += weight;
  }
  return weightTotal ? weightedTotal / weightTotal : 0;
}

function cappedTrendMultiplier(buckets: DayBucket[]) {
  const recent = buckets.slice(-30).map((bucket) => bucket.amount);
  const previous = buckets.slice(-60, -30).map((bucket) => bucket.amount);
  if (!previous.length) return 1;
  const recentRate = sum(recent) / recent.length;
  const previousRate = sum(previous) / previous.length;
  if (!previousRate) return 1;
  return clamp(recentRate / previousRate, 0.75, 1.25);
}

function calculateConfidence(transactionCount: number, activeDays: number, windowDays: number, recurring: RecurringPattern[], values: number[]) {
  const historyScore = clamp(transactionCount / 60, 0, 1);
  const coverageScore = clamp(activeDays / 45, 0, 1);
  const recurrenceScore = recurring.length ? recurring.reduce((total, pattern) => total + pattern.confidence, 0) / recurring.length : 0.35;
  const stabilityValues = values.filter((value) => value > 0);
  const mean = sum(stabilityValues) / Math.max(stabilityValues.length, 1);
  const stabilityScore = mean ? clamp(1 - standardDeviation(stabilityValues) / (mean * 2), 0, 1) : 0;
  return clamp(historyScore * 0.4 + coverageScore * 0.3 + recurrenceScore * 0.15 + stabilityScore * 0.15, 0, 1);
}

function robustCap(values: number[]) {
  const positive = values.filter((value) => value > 0).sort((left, right) => left - right);
  if (positive.length < 3) return Math.max(...values, 0);
  const middle = median(positive);
  const deviations = positive.map((value) => Math.abs(value - middle));
  const mad = median(deviations);
  const percentileIndex = Math.min(positive.length - 1, Math.floor(positive.length * 0.95));
  return Math.max(middle + 3 * mad, positive[percentileIndex] ?? middle);
}

function consistency(values: number[], center: number) {
  if (!values.length || center <= 0) return 0;
  const deviation = median(values.map((value) => Math.abs(value - center)));
  return clamp(1 - deviation / center, 0, 1);
}

function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const mean = sum(values) / values.length;
  return Math.sqrt(sum(values.map((value) => (value - mean) ** 2)) / values.length);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function sumForWindow(transactions: Transaction[], start: Date, end: Date) {
  return sum(transactions.filter((transaction) => {
    const date = new Date(transaction.occurredAt);
    return date >= start && date <= end;
  }).map((transaction) => transaction.amount));
}

function uniqueTransactions(transactions: Transaction[]) {
  const byId = new Map<string, Transaction>();
  for (const transaction of transactions) byId.set(transaction.id, transaction);
  return Array.from(byId.values());
}

function isExpense(transaction: Transaction) {
  return transaction.deletedAt === null && transaction.kind === "expense";
}

function normalizeMerchant(merchant: string | null) {
  const normalized = merchant?.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || null;
}

function asDate(value: Date | string) {
  return value instanceof Date ? new Date(value) : new Date(value);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function daysBetween(start: Date, end: Date) {
  return Math.max(1, Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS) + 1);
}

function listDates(start: Date, end: Date) {
  const dates: Date[] = [];
  for (let date = startOfDay(start); date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function maxDate(...dates: Date[]) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function minDate(...dates: Date[]) {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatHour(hour: number) {
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:00 ${period}`;
}
