import type { Debt } from "./schema";

export type DebtScoreBand = "No history" | "Needs attention" | "Fair" | "Good" | "Very good" | "Excellent";
export type DebtScoreConfidence = "Low" | "Medium" | "High";

export type DebtScoreFactor = {
  label: string;
  detail: string;
  tone: "positive" | "negative" | "neutral";
};

export type SimulatedDebtScore = {
  score: number;
  band: DebtScoreBand;
  confidence: DebtScoreConfidence;
  factors: DebtScoreFactor[];
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function scoreBand(score: number): DebtScoreBand {
  if (score >= 800) return "Excellent";
  if (score >= 740) return "Very good";
  if (score >= 670) return "Good";
  if (score >= 580) return "Fair";
  return "Needs attention";
}

export function buildSimulatedDebtScore(debts: Debt[], reference = new Date()): SimulatedDebtScore {
  if (!debts.length) {
    return {
      score: 650,
      band: "No history",
      confidence: "Low",
      factors: [{ label: "No debt history yet", detail: "Add and update debts to build an estimate.", tone: "neutral" }],
    };
  }

  const now = reference.getTime();
  const paid = debts.filter((debt) => Boolean(debt.paidAt));
  const onTimePaid = paid.filter((debt) => new Date(debt.paidAt!).getTime() <= new Date(debt.dueAt).getTime());
  const overdue = debts.filter((debt) => !debt.paidAt && new Date(debt.dueAt).getTime() < now);
  const upcoming = debts.filter((debt) => !debt.paidAt && new Date(debt.dueAt).getTime() >= now);
  const outstandingAmount = debts.filter((debt) => !debt.paidAt).reduce((sum, debt) => sum + debt.amount, 0);
  const overdueAmount = overdue.reduce((sum, debt) => sum + debt.amount, 0);
  const onTimeRate = paid.length ? onTimePaid.length / paid.length : 0;
  const overdueShare = outstandingAmount ? overdueAmount / outstandingAmount : 0;
  const resolvedDueItems = paid.length + overdue.length;
  const completionRate = resolvedDueItems ? paid.length / resolvedDueItems : 0;
  const recentPaid = paid.filter((debt) => now - new Date(debt.paidAt!).getTime() <= 90 * 24 * 60 * 60 * 1000);
  const recentOnTimeBonus = recentPaid.length >= 2 && recentPaid.every((debt) => new Date(debt.paidAt!).getTime() <= new Date(debt.dueAt).getTime()) ? 20 : 0;

  const paymentAdjustment = paid.length ? Math.round((onTimeRate - 0.5) * 180) : 0;
  const overduePenalty = Math.min(220, overdue.length * 45 + Math.round(overdueShare * 100));
  const completionBonus = Math.round(completionRate * 40);
  const historyBonus = Math.min(40, debts.length * 5);
  const rawScore = clamp(680 + paymentAdjustment - overduePenalty + completionBonus + historyBonus + recentOnTimeBonus, 300, 850);
  const reliability = Math.min(1, debts.length / 6);
  const score = clamp(Math.round(650 + (rawScore - 650) * (0.4 + reliability * 0.6)), 300, 850);
  const confidence: DebtScoreConfidence = debts.length >= 8 ? "High" : debts.length >= 3 ? "Medium" : "Low";
  const factors: DebtScoreFactor[] = [];

  if (paid.length) {
    factors.push({
      label: "Payment history",
      detail: `${onTimePaid.length} of ${paid.length} paid on or before the due date.`,
      tone: onTimeRate >= 0.8 ? "positive" : onTimeRate >= 0.5 ? "neutral" : "negative",
    });
  } else {
    factors.push({ label: "Payment history", detail: "No paid debts recorded yet.", tone: "neutral" });
  }
  factors.push({
    label: "Overdue obligations",
    detail: overdue.length ? `${overdue.length} unpaid overdue item${overdue.length === 1 ? "" : "s"}.` : "No unpaid overdue items.",
    tone: overdue.length ? "negative" : "positive",
  });
  factors.push({
    label: "Upcoming obligations",
    detail: `${upcoming.length} open item${upcoming.length === 1 ? "" : "s"} not yet overdue.`,
    tone: "neutral",
  });
  factors.push({
    label: "History depth",
    detail: `${debts.length} debt record${debts.length === 1 ? "" : "s"}; more history improves confidence.`,
    tone: debts.length >= 6 ? "positive" : "neutral",
  });

  return { score, band: scoreBand(score), confidence, factors };
}
