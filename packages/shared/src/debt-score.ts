import type { Debt } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DebtHealthBand = "Insufficient history" | "Needs attention" | "Fair" | "Good" | "Excellent";
export type DebtHealthConfidence = "Low" | "Medium" | "High";

export type DebtHealthFactor = {
  label: string;
  detail: string;
  tone: "positive" | "negative" | "neutral";
};

export type DebtPaymentHealth = {
  /** A transparent 0–100 behavior indicator, or null before any obligation can be evaluated. */
  score: number | null;
  band: DebtHealthBand;
  confidence: DebtHealthConfidence;
  evaluatedCount: number;
  factors: DebtHealthFactor[];
};

type EvaluatedDebt = {
  debt: Debt;
  daysLate: number;
  performance: number;
  recencyWeight: number;
};

function scoreBand(score: number): DebtHealthBand {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  return "Needs attention";
}

/**
 * Converts lateness into an easy-to-audit 0–100 performance value.
 *
 * The 30/60/90-day buckets reflect the increasing severity of late payments used
 * by consumer-credit models. These point values are an app-owned behavioral
 * scale, not a reverse-engineered FICO or VantageScore formula.
 */
function paymentPerformance(daysLate: number) {
  if (daysLate <= 0) return 100;
  if (daysLate < 30) return 70;
  if (daysLate < 60) return 40;
  if (daysLate < 90) return 15;
  return 0;
}

/**
 * Recent behavior receives more weight, while older records remain relevant.
 * The weights are deliberately coarse so the result can be explained exactly.
 */
function recencyWeight(dueAt: number, now: number) {
  const ageDays = Math.max(0, Math.floor((now - dueAt) / DAY_MS));
  if (ageDays <= 90) return 1;
  if (ageDays <= 365) return 0.75;
  return 0.5;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function historyConfidence(evaluated: EvaluatedDebt[]): DebtHealthConfidence {
  if (evaluated.length < 6) return "Low";

  const dueDates = evaluated.map((item) => new Date(item.debt.dueAt).getTime());
  const historySpanDays = (Math.max(...dueDates) - Math.min(...dueDates)) / DAY_MS;
  if (evaluated.length >= 12 && historySpanDays >= 365) return "High";
  if (historySpanDays >= 90) return "Medium";
  return "Low";
}

/**
 * Builds a debt-payment health indicator from data this app can actually see.
 *
 * This is not a consumer credit score. Real credit scores require bureau data
 * such as credit limits and utilization, account age and mix, inquiries, and
 * derogatory public-record information. Future unpaid debts are excluded until
 * their due date passes; paid debts are evaluated against their due date.
 */
export function buildDebtPaymentHealth(debts: Debt[], reference = new Date()): DebtPaymentHealth {
  const now = reference.getTime();
  const evaluated = debts.reduce<EvaluatedDebt[]>((items, debt) => {
    const dueAt = new Date(debt.dueAt).getTime();
    const paidAt = debt.paidAt ? new Date(debt.paidAt).getTime() : null;
    if (!Number.isFinite(dueAt) || (paidAt === null && dueAt >= now)) return items;

    const observedAt = paidAt ?? now;
    const daysLate = Math.max(0, Math.ceil((observedAt - dueAt) / DAY_MS));
    items.push({
      debt,
      daysLate,
      performance: paymentPerformance(daysLate),
      recencyWeight: recencyWeight(dueAt, now),
    });
    return items;
  }, []);

  const upcomingCount = debts.filter((debt) => !debt.paidAt && new Date(debt.dueAt).getTime() >= now).length;

  if (!evaluated.length) {
    return {
      score: null,
      band: "Insufficient history",
      confidence: "Low",
      evaluatedCount: 0,
      factors: [
        {
          label: "No evaluated payments",
          detail: upcomingCount
            ? `${upcomingCount} upcoming ${plural(upcomingCount, "item")} will count after being paid or becoming overdue.`
            : "Record a payment or an overdue due date to begin measuring behavior.",
          tone: "neutral",
        },
        {
          label: "Credit-data coverage",
          detail: "Credit limits, utilization, account age and mix, inquiries, and bureau records are unavailable.",
          tone: "neutral",
        },
      ],
    };
  }

  const totalWeight = evaluated.reduce((sum, item) => sum + item.recencyWeight, 0);
  const score = Math.round(
    evaluated.reduce((sum, item) => sum + item.performance * item.recencyWeight, 0) / totalWeight,
  );
  const confidence = historyConfidence(evaluated);
  const paid = evaluated.filter((item) => Boolean(item.debt.paidAt));
  const onTimePaid = paid.filter((item) => item.daysLate === 0);
  const late = evaluated.filter((item) => item.daysLate > 0);
  const materiallyLate = late.filter((item) => item.daysLate >= 30);
  const severelyLate = late.filter((item) => item.daysLate >= 90);
  const overdue = evaluated.filter((item) => !item.debt.paidAt);
  const maximumDaysOverdue = overdue.reduce((maximum, item) => Math.max(maximum, item.daysLate), 0);
  const dueDates = evaluated.map((item) => new Date(item.debt.dueAt).getTime());
  const historySpanDays = Math.round((Math.max(...dueDates) - Math.min(...dueDates)) / DAY_MS);

  const factors: DebtHealthFactor[] = [];

  if (overdue.length) {
    factors.push({
      label: "Current overdue status",
      detail: `${overdue.length} unpaid ${plural(overdue.length, "item")} overdue; oldest is ${maximumDaysOverdue} ${plural(maximumDaysOverdue, "day")} late.`,
      tone: "negative",
    });
  } else {
    factors.push({
      label: "Current overdue status",
      detail: "No currently overdue items.",
      tone: "positive",
    });
  }

  if (materiallyLate.length) {
    factors.push({
      label: "Late-payment severity",
      detail: `${materiallyLate.length} ${plural(materiallyLate.length, "item")} reached 30+ days late${severelyLate.length ? `; ${severelyLate.length} reached 90+ days` : ""}.`,
      tone: "negative",
    });
  } else if (late.length) {
    factors.push({
      label: "Late-payment severity",
      detail: `${late.length} ${plural(late.length, "item")} late by fewer than 30 days.`,
      tone: "neutral",
    });
  } else {
    factors.push({
      label: "Payment timeliness",
      detail: paid.length
        ? `${onTimePaid.length} of ${paid.length} recorded ${plural(paid.length, "payment")} paid on or before the due date.`
        : "No late behavior among the evaluated items.",
      tone: "positive",
    });
  }

  if (late.length && paid.length) {
    factors.push({
      label: "Payment timeliness",
      detail: `${onTimePaid.length} of ${paid.length} recorded ${plural(paid.length, "payment")} paid on or before the due date.`,
      tone: onTimePaid.length === paid.length ? "positive" : onTimePaid.length >= paid.length / 2 ? "neutral" : "negative",
    });
  }

  factors.push({
    label: "History confidence",
    detail: `${evaluated.length} evaluated ${plural(evaluated.length, "item")} across ${historySpanDays} ${plural(historySpanDays, "day")}; this affects confidence, not the score.`,
    tone: confidence === "High" ? "positive" : "neutral",
  });

  return {
    score,
    band: scoreBand(score),
    confidence,
    evaluatedCount: evaluated.length,
    factors: factors.slice(0, 4),
  };
}

/**
 * @deprecated Use buildDebtPaymentHealth. Kept temporarily for consumers that
 * imported the earlier name.
 */
export const buildSimulatedDebtScore = buildDebtPaymentHealth;
export type SimulatedDebtScore = DebtPaymentHealth;
export type DebtScoreBand = DebtHealthBand;
export type DebtScoreConfidence = DebtHealthConfidence;
export type DebtScoreFactor = DebtHealthFactor;
