import type { AiPredictionRequest, AiPredictionResponse } from "@spending-tracker/shared";
import { aiPredictionResponseSchema } from "@spending-tracker/shared";
import { config } from "./config";

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

const aiPredictionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectedTotal: { type: "number" },
    categories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string" },
          projectedTotal: { type: "number" },
        },
        required: ["category", "projectedTotal"],
      },
    },
    points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string" },
          projectedAmount: { type: "number" },
        },
        required: ["date", "projectedAmount"],
      },
    },
  },
  required: ["projectedTotal", "categories", "points"],
} as const;

export async function predictSpending(input: AiPredictionRequest): Promise<AiPredictionResponse> {
  try {
    const response = await fetch(`${config.aiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(config.aiTimeoutMs),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.aiModel,
        temperature: 0,
        max_tokens: 600,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "spending_forecast",
            strict: true,
            schema: aiPredictionJsonSchema,
          },
        },
        messages: [
          {
            role: "system",
            content: "You are a careful personal-spending forecaster. Return only valid JSON matching the requested schema. Use the transaction dates, categories, merchants, notes, recurring habits, weekday patterns, and forecast dates. Treat unusually large transactions as one-off outliers unless repeated evidence shows they are recurring. Do not multiply a single outlier into future spending. Never add explanation or markdown.",
          },
          { role: "user", content: buildModelPrompt(input) },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Local AI service returned ${response.status}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Local AI service returned no prediction");
    }
    try {
      return parseModelPrediction(content, input);
    } catch (parseError) {
      console.warn("AI prediction returned an invalid forecast; using local fallback", parseError);
      return buildFallbackPrediction(input);
    }
  } catch (error) {
    try {
      return await predictWithLegacyCompletion(input);
    } catch (legacyError) {
      console.warn(
        "AI prediction unavailable; using local fallback",
        legacyError instanceof Error ? legacyError.message : error,
      );
      return buildFallbackPrediction(input);
    }
  }
}

async function predictWithLegacyCompletion(input: AiPredictionRequest): Promise<AiPredictionResponse> {
  const response = await fetch(`${config.aiBaseUrl}/v1/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(config.aiTimeoutMs),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.aiModel,
      temperature: 0,
      max_tokens: 600,
      prompt: `${buildModelPrompt(input)}\nReturn only the JSON object.`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Local AI completions returned ${response.status}`);
  }
  const payload = (await response.json()) as { choices?: Array<{ text?: string | null }> };
  const content = payload.choices?.[0]?.text;
  if (!content) {
    throw new Error("Local AI completions returned no prediction");
  }
  return parseModelPrediction(content, input);
}

function buildModelPrompt(input: AiPredictionRequest) {
  const transactions = input.transactions.map((transaction) => [
    transaction.occurredAt,
    transaction.category,
    transaction.amount,
    transaction.merchant ?? "",
    transaction.note ?? "",
  ].join(" | ")).join("\n");

  return [
    input.instruction,
    "Return exactly this JSON shape:",
    '{"projectedTotal": number, "categories": [{"category": string, "projectedTotal": number}], "points": [{"date": string, "projectedAmount": number}]}',
    "projectedTotal is the total expense by the forecast end, including observed and expected future spending.",
    "categories contains the forecast total for each observed category; use the exact category names supplied.",
    "points contains one possible spending amount for every supplied future date; use the exact dates supplied and do not omit them.",
    "Keep every number non-negative. Do not invent a new category. If there is no evidence for future spending, use zero.",
    "projectedTotal must equal observed spending plus only plausible future spending. Treat an unusually large single transaction as a one-off unless similar transactions repeat; do not assume it happens again.",
    "Base future points on recurring and typical behavior, not on multiplying the largest transaction. Categories must include observed spending and plausible future amounts.",
    "Use the habit profile below as evidence. It describes the supplied history; it is not a forecast. Prefer the typical amount and repeated merchant/category patterns over isolated extremes.",
    `Currency: ${input.currency}`,
    `Range: ${input.range.title}; observed from ${input.range.from ?? "start"} through ${input.range.to ?? "today"}; forecast end ${input.range.forecastTo ?? "today"}`,
    `Categories: ${input.categoryNames.join(", ") || "none"}`,
    `Forecast dates: ${input.forecastDates.join(", ") || "none"}`,
    "Habit profile:",
    buildHabitProfile(input),
    "Transactions (date | category | amount | merchant | note):",
    transactions || "none",
  ].join("\n");
}

function buildHabitProfile(input: AiPredictionRequest) {
  const categoryStats = new Map<string, number[]>();
  const merchantStats = new Map<string, { category: string; amounts: number[] }>();
  const weekdayStats = new Map<string, number[]>();
  const observed = input.transactions.filter((transaction) => isInObservedRange(transaction.occurredAt, input));

  for (const transaction of input.transactions) {
    const categoryAmounts = categoryStats.get(transaction.category) ?? [];
    categoryAmounts.push(transaction.amount);
    categoryStats.set(transaction.category, categoryAmounts);

    const merchant = (transaction.merchant ?? "Unspecified").trim() || "Unspecified";
    const merchantEntry = merchantStats.get(merchant) ?? { category: transaction.category, amounts: [] };
    merchantEntry.amounts.push(transaction.amount);
    merchantStats.set(merchant, merchantEntry);

    const weekday = new Date(transaction.occurredAt).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    const weekdayAmounts = weekdayStats.get(weekday) ?? [];
    weekdayAmounts.push(transaction.amount);
    weekdayStats.set(weekday, weekdayAmounts);
  }

  const observedTotal = observed.reduce((total, transaction) => total + transaction.amount, 0);
  const categoryLines = Array.from(categoryStats.entries())
    .sort((left, right) => right[1].reduce((sum, amount) => sum + amount, 0) - left[1].reduce((sum, amount) => sum + amount, 0))
    .slice(0, 20)
    .map(([category, amounts]) => `${category} | count ${amounts.length} | total ${round(sum(amounts))} | typical ${round(median(amounts))}`);
  const merchantLines = Array.from(merchantStats.entries())
    .sort((left, right) => right[1].amounts.length - left[1].amounts.length)
    .slice(0, 12)
    .map(([merchant, entry]) => `${merchant} | ${entry.category} | count ${entry.amounts.length} | typical ${round(median(entry.amounts))}`);
  const weekdayLines = Array.from(weekdayStats.entries())
    .sort((left, right) => right[1].length - left[1].length)
    .map(([weekday, amounts]) => `${weekday} | count ${amounts.length} | average ${round(sum(amounts) / amounts.length)}`);
  const typicalOverall = median(input.transactions.map((transaction) => transaction.amount));
  const outlierLines = input.transactions
    .filter((transaction) => transaction.amount >= Math.max(typicalOverall * 8, typicalOverall + 1000))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5)
    .map((transaction) => `${transaction.occurredAt.slice(0, 10)} | ${transaction.category} | ${round(transaction.amount)} | ${(transaction.merchant ?? "Unspecified").trim() || "Unspecified"}`);

  return [
    `observed count ${observed.length} | observed total ${round(observedTotal)}`,
    `categories: ${categoryLines.join("; ") || "none"}`,
    `merchants: ${merchantLines.join("; ") || "none"}`,
    `weekdays: ${weekdayLines.join("; ") || "none"}`,
    `large-transaction review candidates (do not repeat without evidence): ${outlierLines.join("; ") || "none"}`,
  ].join("\n");
}

function isInObservedRange(occurredAt: string, input: AiPredictionRequest) {
  const timestamp = new Date(occurredAt).getTime();
  const from = input.range.from ? new Date(input.range.from).getTime() : Number.NEGATIVE_INFINITY;
  const to = input.range.to ? new Date(input.range.to).getTime() : Date.now();
  return timestamp >= from && timestamp <= to;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function parseModelPrediction(content: string, input: AiPredictionRequest): AiPredictionResponse {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Local AI did not return a JSON forecast");
  }
  return normalizePrediction(aiPredictionResponseSchema.parse(JSON.parse(trimmed.slice(start, end + 1))), input);
}

export function normalizePrediction(prediction: AiPredictionResponse, input: AiPredictionRequest): AiPredictionResponse {
  const observed = input.transactions.filter((transaction) => {
    const occurredAt = new Date(transaction.occurredAt).getTime();
    const from = input.range.from ? new Date(input.range.from).getTime() : Number.NEGATIVE_INFINITY;
    const to = input.range.to ? new Date(input.range.to).getTime() : Date.now();
    return occurredAt >= from && occurredAt <= to;
  });
  const observedByCategory = new Map<string, number>();
  for (const transaction of observed) {
    observedByCategory.set(transaction.category, (observedByCategory.get(transaction.category) ?? 0) + transaction.amount);
  }
  const observedTotal = Array.from(observedByCategory.values()).reduce((total, amount) => total + amount, 0);
  const modelByCategory = new Map(prediction.categories.map((category) => [category.category, category.projectedTotal]));
  const categoryNames = Array.from(new Set([
    ...input.categoryNames,
    ...observedByCategory.keys(),
  ])).slice(0, 20);
  const futureWeights = categoryNames.map((category) => {
    if (isUnrepeatedOutlierCategory(category, observed)) {
      return 0;
    }
    return Math.max(0, (modelByCategory.get(category) ?? 0) - (observedByCategory.get(category) ?? 0));
  });
  const weightTotal = futureWeights.reduce((total, weight) => total + weight, 0);
  const futureTotal = weightTotal;
  const projectedTotal = observedTotal + futureTotal;
  const categories = categoryNames.map((category, index) => ({
    category,
    projectedTotal: Number(((observedByCategory.get(category) ?? 0) + (weightTotal > 0
      ? futureTotal * (futureWeights[index] / weightTotal)
      : futureTotal * ((observedByCategory.get(category) ?? 0) / (observedTotal || 1)))).toFixed(2)),
  }));

  const modelByDate = new Map(prediction.points.map((point) => [point.date, point.projectedAmount]));
  const providedValues = input.forecastDates
    .map((date) => modelByDate.get(date))
    .filter((amount): amount is number => typeof amount === "number" && Number.isFinite(amount) && amount >= 0);
  const providedAverage = providedValues.length ? sum(providedValues) / providedValues.length : 0;
  const rawPointValues = input.forecastDates.map((date) => {
    const amount = modelByDate.get(date);
    return Number.isFinite(amount) && amount !== undefined && amount >= 0
      ? amount
      : providedAverage;
  });
  const rawPointTotal = sum(rawPointValues);
  const pointScale = rawPointTotal > 0 ? futureTotal / rawPointTotal : 0;
  const evenPointAmount = input.forecastDates.length ? futureTotal / input.forecastDates.length : 0;
  const points = input.forecastDates.map((date, index) => ({
    date,
    projectedAmount: Number((rawPointTotal > 0 ? rawPointValues[index] * pointScale : evenPointAmount).toFixed(2)),
  }));

  return { projectedTotal, categories, points };
}

function isUnrepeatedOutlierCategory(category: string, observed: AiPredictionRequest["transactions"]) {
  const amounts = observed
    .filter((transaction) => transaction.category === category)
    .map((transaction) => transaction.amount)
    .sort((left, right) => left - right);
  if (amounts.length === 0) return false;

  const overallMedian = median(observed.map((transaction) => transaction.amount));
  const largest = amounts[amounts.length - 1];
  const categoryBaseline = amounts.length > 1 ? median(amounts.slice(0, -1)) : overallMedian;
  const isExtreme = largest >= Math.max(overallMedian * 8, categoryBaseline * 5, overallMedian + 1000);
  const comparableRepeats = amounts.filter((amount) => amount >= largest * 0.5).length;
  return isExtreme && comparableRepeats < 2;
}

function buildFallbackPrediction(input: AiPredictionRequest): AiPredictionResponse {
  const now = Date.now();
  const periodStart = input.range.from ? new Date(input.range.from).getTime() : Number.NEGATIVE_INFINITY;
  const periodEnd = input.range.to ? new Date(input.range.to).getTime() : now;
  const forecastEnd = input.range.forecastTo ? new Date(input.range.forecastTo).getTime() : periodEnd;
  const observed = input.transactions.filter((transaction) => {
    const occurredAt = new Date(transaction.occurredAt).getTime();
    return occurredAt >= periodStart && occurredAt <= Math.min(periodEnd, now);
  });
  const spent = observed.reduce((total, transaction) => total + transaction.amount, 0);
  const firstObserved = observed.reduce(
    (first, transaction) => Math.min(first, new Date(transaction.occurredAt).getTime()),
    now,
  );
  const elapsedDays = Math.max(1, Math.ceil((Math.min(periodEnd, now) - Math.max(periodStart, firstObserved)) / 86400000) + 1);
  const remainingDays = Math.max(0, Math.ceil((forecastEnd - Math.min(periodEnd, now)) / 86400000));
  const projectedTotal = Number((spent + (spent / elapsedDays) * remainingDays).toFixed(2));
  const categoryTotals = new Map<string, number>();
  for (const transaction of observed) {
    categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + transaction.amount);
  }
  if (categoryTotals.size === 0) {
    categoryTotals.set("Uncategorized", 0);
  }
  const remaining = Math.max(0, projectedTotal - spent);
  const categoryWeight = spent || 1;
  const categories = Array.from(categoryTotals.entries()).map(([category, total]) => ({
    category,
    projectedTotal: Number((total + remaining * (total / categoryWeight)).toFixed(2)),
  }));
  const perPoint = input.forecastDates.length ? remaining / input.forecastDates.length : 0;

  return aiPredictionResponseSchema.parse({
    projectedTotal,
    categories,
    points: input.forecastDates.map((date) => ({ date, projectedAmount: Number(perPoint.toFixed(2)) })),
  });
}
