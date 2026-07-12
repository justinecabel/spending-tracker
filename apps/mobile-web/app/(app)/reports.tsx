import { createContext, useContext, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import type { MonthlyReport, Transaction } from "@spending-tracker/shared";
import { ReportCharts } from "../../src/components/report-charts";
import { Card, PageHeader, PillButton, SectionTitle } from "../../src/components/ui";
import { ScreenContainer } from "../../src/components/layout";
import { api } from "../../src/lib/api";
import { formatMoney } from "../../src/lib/date";
import { buildSpendingReport, resolveSummaryRange, type ResolvedSummaryRange } from "../../src/lib/summary-range";
import { draftTransactionsStore } from "../../src/state/draft-transactions";
import { EMPTY_CATEGORIES, EMPTY_TRANSACTIONS, offlineCacheStore, transactionScopeKey } from "../../src/state/offline-cache";
import { summaryRangeStore } from "../../src/state/summary-range";
import { sessionStore } from "../../src/state/session";
import { theme } from "../../src/theme";

type SelectedStat = {
  label: string;
  value: string;
  subvalue?: string;
  details?: string[];
};

const insightStatContext = createContext<(stat: SelectedStat) => void>(() => undefined);

export default function ReportsScreen() {
  const user = sessionStore((state) => state.user);
  const { width } = useWindowDimensions();
  const [selectedStat, setSelectedStat] = useState<SelectedStat | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const drafts = draftTransactionsStore((state) => state.drafts);
  const summaryMode = summaryRangeStore((state) => state.mode);
  const customFrom = summaryRangeStore((state) => state.customFrom);
  const customTo = summaryRangeStore((state) => state.customTo);
  const smartPaydays = summaryRangeStore((state) => state.smartPaydays);
  const range = resolveSummaryRange({
    mode: summaryMode,
    customFrom,
    customTo,
    smartPaydays,
  });
  const userId = user?.id ?? "anonymous";
  const cachedCategories = offlineCacheStore((state) => state.categoriesByUser[userId]) ?? EMPTY_CATEGORIES;
  const transactionCacheId = transactionScopeKey(userId, `reports:${range.key}`);
  const cachedTransactions = offlineCacheStore((state) => state.transactionsByScope[transactionCacheId]) ?? EMPTY_TRANSACTIONS;
  const transactionsQuery = useQuery({
    queryKey: ["transactions", userId, "reports", range.key],
    queryFn: async () => {
      try {
        const transactions = await api.transactions({
          ...(range.from ? { from: range.from } : {}),
          ...(range.to ? { to: range.to } : {}),
        });
        offlineCacheStore.getState().setTransactions(transactionCacheId, transactions);
        return transactions;
      } catch (error) {
        if (cachedTransactions.length > 0) {
          return cachedTransactions;
        }
        throw error;
      }
    },
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", userId],
    queryFn: async () => {
      try {
        const categories = await api.categories();
        offlineCacheStore.getState().setCategories(userId, categories);
        return categories;
      } catch (error) {
        if (cachedCategories.length > 0) {
          return cachedCategories;
        }
        throw error;
      }
    },
  });
  const offlineDrafts = drafts.filter((transaction) => {
    if (transaction.userId !== userId) {
      return false;
    }
    if (range.from && transaction.occurredAt < range.from) {
      return false;
    }
    if (range.to && transaction.occurredAt > range.to) {
      return false;
    }
    return true;
  });
  const transactions = [...offlineDrafts, ...(transactionsQuery.data ?? [])].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );
  const report = buildSpendingReport(range.title, transactions, categoriesQuery.data ?? cachedCategories);
  const analytics = useMemo(
    () => buildAdvancedAnalytics(report, transactions, range),
    [report, range, transactions],
  );
  const isPayCycle = range.title === "Current pay cycle";
  const isAllTime = range.title === "All time";
  const useSideInsights = width >= 1080;
  const forecastEndLabel = isPayCycle ? "Forecast to cycle end" : isAllTime ? "Forecast to year end" : "Forecast to month end";
  const trendLabel = isPayCycle ? "Cycle trend delta" : isAllTime ? "Year-end trend delta" : "Monthly trend delta";
  const statTiles = [
    <StatTile key="forecast" label={forecastEndLabel} value={formatMoney(analytics.projectedMonthEnd, user?.currency ?? "USD")} />,
    <StatTile key="average" label="Average transaction" value={formatMoney(analytics.averageTransaction, user?.currency ?? "USD")} />,
    <StatTile key="median" label="Median transaction" value={formatMoney(analytics.medianTransaction, user?.currency ?? "USD")} />,
    <StatTile key="active-day" label="Spend per active day" value={formatMoney(analytics.averageActiveDaySpend, user?.currency ?? "USD")} />,
    <StatTile key="largest" label="Largest expense" value={formatMoney(analytics.largestTransaction, user?.currency ?? "USD")} />,
    <StatTile key="weekend-share" label="Weekend share" value={`${Math.round(analytics.weekendShare * 100)}%`} />,
    <StatTile key="category-concentration" label="Top category concentration" value={`${Math.round(analytics.topCategoryShare * 100)}%`} />,
    <StatTile key="trend" label={trendLabel} value={`${analytics.projectedVsTrailing >= 0 ? "+" : ""}${Math.round(analytics.projectedVsTrailing * 100)}%`} tone={analytics.projectedVsTrailing > 0.1 ? "negative" : analytics.projectedVsTrailing < -0.1 ? "positive" : "neutral"} />,
    <StatTile key="merchant" label="Top merchant" value={analytics.topMerchantName} subvalue={analytics.topMerchantSpend ? formatMoney(analytics.topMerchantSpend, user?.currency ?? "USD") : undefined} />,
    <StatTile key="weekday" label="Busiest weekday" value={analytics.busiestWeekday} />,
    <StatTile key="hour" label="Busiest hour" value={analytics.busiestHour} />,
    <StatTile key="spend-streak" label="Spend streak" value={`${analytics.longestStreak} days`} />,
    <StatTile key="day-over-day" label="Yesterday vs today" value={analytics.dayOverDayLabel} subvalue={`${formatMoney(analytics.todaySpend, user?.currency ?? "USD")} today`} tone={analytics.dayOverDayTone} />,
    <StatTile key="weekly-pace" label="7-day pace" value={analytics.weeklyPaceLabel} subvalue={`${formatMoney(analytics.recentDailyAverage, user?.currency ?? "USD")} per day`} tone={analytics.weeklyPaceTone} />,
    <StatTile key="no-spend" label="No-spend streak" value={`${analytics.noSpendStreak} days`} subvalue="Consecutive days without spending" tone={analytics.noSpendStreak ? "positive" : "neutral"} />,
    <StatTile key="period-pace" label={isPayCycle ? "Cycle pace" : isAllTime ? "Year-end pace" : "Month pace"} value={analytics.paceLabel} subvalue={analytics.paceDetail} tone={analytics.paceTone} />,
    <StatTile key="unusual" label="Unusual spend" value={analytics.impulseLabel} subvalue={analytics.unusualSpend ? formatMoney(analytics.unusualSpend, user?.currency ?? "USD") : "Based on your typical transaction"} tone={analytics.unusualSpend ? "negative" : "positive"} />,
    <StatTile key="category-shift" label="Category shift" value={analytics.categoryShiftLabel} subvalue={analytics.categoryShiftDetail} />,
    <StatTile key="weekend-pattern" label="Weekend pattern" value={analytics.weekendPatternLabel} subvalue={analytics.weekendPatternDetail} />,
    <StatTile key="free-days" label="Spending-free days" value={`${analytics.spendingFreeDays} of 7`} subvalue="In the last seven days" tone={analytics.spendingFreeDays ? "positive" : "neutral"} />,
  ];
  const sideStatTiles = [...statTiles.slice(0, 4), ...statTiles.slice(4).filter((_, index) => index % 2 === 1)];
  const belowForecastTiles = statTiles.slice(4).filter((_, index) => index % 2 === 0);
  const statDetails = (label: string) => {
    const currency = user?.currency ?? "USD";
    const total = formatMoney(report?.expenseTotal ?? 0, currency);
    if (label === "Spend per active day") {
      return [
        `Total spend: ${total}`,
        `Active days: ${analytics.activeDayCount}`,
        `${total} ÷ ${analytics.activeDayCount || 1} active days = ${formatMoney(analytics.averageActiveDaySpend, currency)}`,
      ];
    }
    if (label === "Average transaction") {
      return [
        `Total spend: ${total}`,
        `Transactions: ${analytics.transactionCount}`,
        `${total} ÷ ${analytics.transactionCount || 1} transactions = ${formatMoney(analytics.averageTransaction, currency)}`,
      ];
    }
    return [];
  };
  const hasTransactions = transactions.length > 0;
  const queryErrorMessage = transactionsQuery.error?.message ?? categoriesQuery.error?.message ?? null;

  return (
    <insightStatContext.Provider value={(stat) => setSelectedStat({ ...stat, details: statDetails(stat.label) })}>
    <ScreenContainer
      screenKey="reports"
      refreshing={isRefreshing}
      onRefresh={async () => {
        setIsRefreshing(true);
        try {
          await Promise.all([transactionsQuery.refetch(), categoriesQuery.refetch()]);
        } finally {
          setIsRefreshing(false);
        }
      }}
    >
      <PageHeader title="Reports" subtitle={range.subtitle ? `${range.title} · ${range.subtitle}` : range.title} />
      <Card>
        <SectionTitle
          title="Category breakdown"
          subtitle={range.subtitle ? `${range.title} · ${range.subtitle}` : range.title}
        />
        {queryErrorMessage && !hasTransactions ? <Text style={styles.errorText}>{queryErrorMessage}</Text> : null}
        {report ? <ReportCharts report={report} currency={user?.currency ?? "USD"} /> : null}
      </Card>
      <Card>
        <SectionTitle
          title="Insights"
          subtitle="Deeper spending diagnostics, cadence, and predictions."
        />
        {!hasTransactions ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No insights yet.</Text>
          </View>
        ) : (
          <>
            <View style={[styles.insightsLayout, useSideInsights && styles.insightsLayoutWide]}>
              <View style={[styles.forecastColumn, useSideInsights && styles.forecastColumnWide]}>
                <ForecastChart
                  transactions={transactions}
                  projected={analytics.projectedMonthEnd}
                  currency={user?.currency ?? "USD"}
                  range={range}
                />
                {useSideInsights ? <View style={styles.nerdGrid}>{belowForecastTiles}</View> : null}
              </View>
              <View style={[styles.nerdGrid, useSideInsights && styles.nerdGridSide]}>
                {useSideInsights ? sideStatTiles : statTiles}
              </View>
            </View>
          </>
        )}
      </Card>
    </ScreenContainer>
    <Modal transparent visible={Boolean(selectedStat)} animationType="none" onRequestClose={() => setSelectedStat(null)}>
      <View style={styles.statModalScrim}>
        <View style={styles.statModalCard}>
          <Text style={styles.statModalLabel}>{selectedStat?.label}</Text>
          <Text style={styles.statModalValue}>{selectedStat?.value}</Text>
          {selectedStat?.subvalue ? <Text style={styles.statModalSubvalue}>{selectedStat.subvalue}</Text> : null}
          <Text style={styles.statModalDescription}>{selectedStat ? describeStat(selectedStat.label) : ""}</Text>
          {selectedStat?.details?.length ? (
            <View style={styles.statModalDetails}>
              {selectedStat.details.map((detail) => <Text key={detail} style={styles.statModalDetail}>• {detail}</Text>)}
            </View>
          ) : null}
          <PillButton label="Close" tone="ghost" onPress={() => setSelectedStat(null)} />
        </View>
      </View>
    </Modal>
    </insightStatContext.Provider>
  );
}

type StatTone = "positive" | "neutral" | "negative";

function StatTile({
  label,
  value,
  subvalue,
  tone = "neutral",
}: {
  label: string;
  value: string;
  subvalue?: string;
  tone?: StatTone;
}) {
  const openStat = useContext(insightStatContext);
  return (
    <Pressable style={styles.statTile} onPress={() => openStat({ label, value, subvalue })}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone === "positive" && styles.statValuePositive, tone === "negative" && styles.statValueNegative]}>{value}</Text>
      {subvalue ? <Text style={styles.statSubvalue}>{subvalue}</Text> : null}
    </Pressable>
  );
}

function describeStat(label: string) {
  const descriptions: Record<string, string> = {
    "Average transaction": "Your total spending divided by the number of transactions in the selected range.",
    "Median transaction": "The middle transaction amount after ordering all transactions from smallest to largest. It is less affected by one unusually large purchase.",
    "Spend per active day": "Your total spending divided by the number of days on which you recorded at least one transaction.",
    "Largest expense": "The single largest expense recorded in the selected range.",
    "Weekend share": "The share of total spending recorded on Saturdays and Sundays.",
    "Top category concentration": "The percentage of spending assigned to your largest category. A high value means spending is concentrated in one category.",
    "Top merchant": "The merchant or note with the highest combined spending in the selected range.",
    "Busiest weekday": "The weekday with the highest total spending.",
    "Busiest hour": "The hour of day with the highest total spending.",
    "Spend streak": "The longest run of consecutive days with at least one recorded expense.",
    "Yesterday vs today": "Compares today's spending with yesterday's spending. Lower spending is shown as favorable.",
    "7-day pace": "Compares total spending in the latest seven days with the seven days before that.",
    "No-spend streak": "The current consecutive run of days without a recorded expense.",
    "Unusual spend": "Flags a purchase that is more than twice your median transaction amount when enough history is available.",
    "Category shift": "Shows the category whose spending share changed the most in the last seven days compared with the prior seven days.",
    "Weekend pattern": "The portion of your recent seven-day spend that happened on a weekend.",
    "Spending-free days": "The number of days without a recorded expense in the last seven days.",
  };

  if (label.includes("Forecast")) {
    return "A run-rate estimate based on spending so far in the selected period, blended with the previous 90 days when that history is available.";
  }
  if (label.includes("trend delta")) {
    return "Compares the current forecast with the average of the prior three available months. Higher spending is shown as a warning.";
  }
  if (label.includes("pace")) {
    return "Compares spending so far with the amount expected by this point in the selected period's forecast.";
  }

  return descriptions[label] ?? "Calculated from the transactions in your selected summary range.";
}

function ForecastChart({ transactions, projected, currency, range }: { transactions: Transaction[]; projected: number; currency: string; range: ResolvedSummaryRange }) {
  const { actualPoints, projectedPoints, currentPoint, spent, points } = buildForecastChart(transactions, projected, range);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(520);
  const selectedPoint = selectedDay === null ? undefined : points.find((point) => point.day === selectedDay);
  // Reserve enough room for both axis labels on narrow screens. The end
  // label yields before their text boxes can touch.
  const showEndAxisLabel = currentPoint.day < points.length && currentPoint.x < 400;
  const selectNearestPoint = (event: any) => {
    const bounds = event?.currentTarget?.getBoundingClientRect?.();
    const clientX = Number(event?.nativeEvent?.clientX);
    const offsetX = Number(event?.nativeEvent?.offsetX);
    const locationX = Number(event?.nativeEvent?.locationX);
    const hasClientCoordinates = Boolean(bounds) && Number.isFinite(clientX);
    const hasOffsetX = Number.isFinite(offsetX);
    const rawX = hasClientCoordinates ? clientX - bounds.left : hasOffsetX ? offsetX : locationX;
    if (!Number.isFinite(rawX)) {
      return;
    }
    // clientX relative to the chart bounds is stable at every responsive
    // width. The remaining paths retain tap support on native platforms.
    const chartX = hasClientCoordinates || hasOffsetX
      ? (rawX / Math.max(bounds?.width ?? chartWidth, 1)) * 520
      : rawX;
    const day = Math.round(1 + ((chartX - 24) / 476) * Math.max(points.length - 1, 1));
    setSelectedDay(Math.max(1, Math.min(points.length, day)));
  };

  return (
    <View style={styles.forecastChart}>
      <View style={styles.forecastHeader}>
        <View>
          <Text style={styles.forecastTitle}>{range.title === "Current pay cycle" ? "Pay-cycle forecast" : range.title === "All time" ? "Year-end forecast" : "Month-end forecast"}</Text>
          <Text style={styles.statSubvalue}>{formatMoney(spent, currency)} actual · {formatMoney(projected, currency)} projected</Text>
        </View>
        <View style={styles.forecastLegend}>
          <View style={[styles.legendLine, styles.actualLegend]} />
          <Text style={styles.legendText}>Actual</Text>
          <View style={[styles.legendLine, styles.projectedLegend]} />
          <Text style={styles.legendText}>Projected</Text>
        </View>
      </View>
      <Svg
        width="100%"
        height={158}
        viewBox="0 0 520 158"
        onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        {...(Platform.OS === "web" ? ({ onMouseLeave: () => setSelectedDay(null) } as any) : {})}
      >
        <Line x1="24" y1="132" x2="500" y2="132" stroke={theme.colors.border} strokeWidth="1" />
        {selectedPoint ? <Line x1={selectedPoint.x} y1="16" x2={selectedPoint.x} y2="132" stroke={theme.colors.border} strokeDasharray="4 5" /> : null}
        <Polyline points={projectedPoints} fill="none" stroke={theme.colors.warning} strokeWidth="3" strokeDasharray="7 6" />
        <Polyline points={actualPoints} fill="none" stroke={theme.colors.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {selectedPoint ? (
          <>
            {selectedPoint.actual !== null ? <Circle cx={selectedPoint.x} cy={selectedPoint.actualY} r="5" fill={theme.colors.accent} stroke={theme.colors.field} strokeWidth="2" /> : null}
            {selectedPoint.actual === null ? <Circle cx={selectedPoint.x} cy={selectedPoint.projectedY} r="5" fill={theme.colors.warning} stroke={theme.colors.field} strokeWidth="2" /> : null}
            <ForecastPointTooltip point={selectedPoint} currency={currency} />
          </>
        ) : null}
        <Rect x="0" y="0" width="520" height="158" fill="transparent" onPress={selectNearestPoint} {...(Platform.OS === "web" ? ({ onMouseMove: selectNearestPoint } as any) : {})} />
      </Svg>
      <View style={styles.forecastAxis}>
        <Text style={[styles.statSubvalue, styles.axisStart]}>Start</Text>
        <Text style={[styles.statSubvalue, styles.axisToday, { left: `${(currentPoint.x / 520) * 100}%` }]}>Today</Text>
        {showEndAxisLabel ? (
          <Text style={[styles.statSubvalue, styles.axisEnd]}>{range.title === "Current pay cycle" ? "Cycle end" : range.title === "All time" ? "Year end" : "Month end"}</Text>
        ) : null}
      </View>
    </View>
  );
}

function buildForecastChart(transactions: Transaction[], projected: number, range: ResolvedSummaryRange) {
  const latestMonth = transactions.reduce<string>(
    (latest, transaction) => (transaction.occurredAt.slice(0, 7) > latest ? transaction.occurredAt.slice(0, 7) : latest),
    "",
  );
  const monthDate = range.from ? new Date(range.from) : new Date(`${latestMonth || new Date().toISOString().slice(0, 7)}-01T00:00:00`);
  const rangeEnd = range.forecastTo ? new Date(range.forecastTo) : new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
  const daysInMonth = Math.max(1, Math.ceil((rangeEnd.getTime() - monthDate.getTime()) / 86400000) + 1);
  const now = new Date();
  const observedEnd = range.to ? new Date(range.to) : now;
  const currentDay = Math.max(1, Math.min(daysInMonth, Math.ceil((Math.min(now.getTime(), observedEnd.getTime()) - monthDate.getTime()) / 86400000) + 1));
  const dailyTotals = new Map<number, number>();

  for (const transaction of transactions) {
    const occurredAt = new Date(transaction.occurredAt);
    if (occurredAt < monthDate || occurredAt > observedEnd) {
      continue;
    }
    const day = Math.floor((occurredAt.getTime() - monthDate.getTime()) / 86400000) + 1;
    dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + transaction.amount);
  }

  const spent = Array.from(dailyTotals.values()).reduce((total, amount) => total + amount, 0);
  const maxValue = Math.max(projected, spent, 1);
  const xForDay = (day: number) => 24 + ((day - 1) / Math.max(daysInMonth - 1, 1)) * 476;
  const yForAmount = (amount: number) => 132 - (amount / maxValue) * 106;
  let runningTotal = 0;
  const actual = [] as string[];
  const prediction = [] as string[];
  const points: Array<{ day: number; x: number; y: number; actualY: number; projectedY: number; actual: number | null; projected: number; hasActivity: boolean }> = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    if (day <= currentDay) {
      runningTotal += dailyTotals.get(day) ?? 0;
      actual.push(`${xForDay(day)},${yForAmount(runningTotal)}`);
    }
    const dayProjection = day <= currentDay
      ? runningTotal
      : spent + ((projected - spent) / Math.max(daysInMonth - currentDay, 1)) * (day - currentDay);
    if (day >= currentDay) {
      prediction.push(`${xForDay(day)},${yForAmount(dayProjection)}`);
    }
    points.push({
      day,
      x: xForDay(day),
      y: yForAmount(day <= currentDay ? runningTotal : dayProjection),
      actualY: yForAmount(runningTotal),
      projectedY: yForAmount(dayProjection),
      actual: day <= currentDay ? runningTotal : null,
      projected: dayProjection,
      hasActivity: dailyTotals.has(day),
    });
  }

  return {
    actualPoints: actual.join(" "),
    projectedPoints: prediction.join(" "),
    currentPoint: { day: currentDay, x: xForDay(currentDay) },
    spent,
    points,
  };
}

function ForecastPointTooltip({
  point,
  currency,
}: {
  point: { x: number; actualY: number; projectedY: number; actual: number | null; projected: number };
  currency: string;
}) {
  const value = point.actual ?? point.projected;
  const pointY = point.actual === null ? point.projectedY : point.actualY;
  const tooltipWidth = 108;
  const tooltipX = Math.max(8, Math.min(404, point.x - tooltipWidth / 2));
  const tooltipY = pointY < 48 ? pointY + 12 : pointY - 42;

  return (
    <>
      <Rect x={tooltipX} y={tooltipY} width={tooltipWidth} height="30" rx="8" fill={theme.colors.card} />
      <SvgText x={tooltipX + tooltipWidth / 2} y={tooltipY + 20} fill={theme.colors.ink} fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" fontSize="13" fontWeight="700" textAnchor="middle">
        {formatMoney(value, currency)}
      </SvgText>
    </>
  );
}

function buildAdvancedAnalytics(report: MonthlyReport | undefined, transactions: Transaction[], range: ResolvedSummaryRange) {
  const monthTransactions = [...transactions].sort(
    (left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
  );

  const monthKey = transactions.reduce<string>(
    (latest, transaction) => (transaction.occurredAt.slice(0, 7) > latest ? transaction.occurredAt.slice(0, 7) : latest),
    new Date().toISOString().slice(0, 7),
  );
  const forecastStart = range.from ?? `${monthKey}-01T00:00:00.000Z`;
  const forecastEnd = range.forecastTo ?? `${monthKey}-31T23:59:59.999Z`;
  const observedEnd = range.to ?? new Date().toISOString();
  const forecastTransactions = monthTransactions.filter((transaction) => transaction.occurredAt >= forecastStart && transaction.occurredAt <= observedEnd);
  const amounts = monthTransactions.map((transaction) => transaction.amount).sort((left, right) => left - right);
  const expenseTotal = report?.expenseTotal ?? 0;
  const forecastExpenseTotal = forecastTransactions.reduce((total, transaction) => total + transaction.amount, 0);
  const uniqueDays = Array.from(new Set(monthTransactions.map((transaction) => transaction.occurredAt.slice(0, 10))));
  const averageTransaction = amounts.length ? expenseTotal / amounts.length : 0;
  const medianTransaction = amounts.length ? median(amounts) : 0;
  const averageActiveDaySpend = uniqueDays.length ? expenseTotal / uniqueDays.length : 0;
  const largestTransaction = amounts.length ? amounts[amounts.length - 1] : 0;
  const weekendSpend = monthTransactions.reduce((total, transaction) => {
    const weekday = new Date(transaction.occurredAt).getDay();
    return weekday === 0 || weekday === 6 ? total + transaction.amount : total;
  }, 0);

  const merchantTotals = new Map<string, number>();
  const weekdayTotals = new Map<number, number>();
  const hourTotals = new Map<number, number>();
  const monthTotals = new Map<string, number>();

  for (const transaction of transactions) {
    const merchant = transaction.merchant?.trim();
    if (merchant) {
      merchantTotals.set(merchant, (merchantTotals.get(merchant) ?? 0) + transaction.amount);
    }

    const date = new Date(transaction.occurredAt);
    const weekday = date.getDay();
    const hour = date.getHours();
    const bucket = transaction.occurredAt.slice(0, 7);
    weekdayTotals.set(weekday, (weekdayTotals.get(weekday) ?? 0) + transaction.amount);
    hourTotals.set(hour, (hourTotals.get(hour) ?? 0) + transaction.amount);
    monthTotals.set(bucket, (monthTotals.get(bucket) ?? 0) + transaction.amount);
  }

  const previousMonths = Array.from(monthTotals.entries())
    .filter(([bucket]) => bucket < monthKey)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-3)
    .map(([, total]) => total);
  const trailingAverage = previousMonths.length
    ? previousMonths.reduce((total, value) => total + value, 0) / previousMonths.length
    : forecastExpenseTotal;

  const monthDate = new Date(forecastStart);
  const now = new Date();
  const totalDays = Math.max(1, Math.ceil((new Date(forecastEnd).getTime() - monthDate.getTime()) / 86400000) + 1);
  const elapsedDays = Math.max(1, Math.min(totalDays, Math.ceil((Math.min(now.getTime(), new Date(observedEnd).getTime()) - monthDate.getTime()) / 86400000) + 1));
  const historyStart = new Date(monthDate);
  historyStart.setDate(historyStart.getDate() - 90);
  const historicalSpend = transactions.reduce((total, transaction) => {
    const occurredAt = new Date(transaction.occurredAt);
    return occurredAt >= historyStart && occurredAt < monthDate ? total + transaction.amount : total;
  }, 0);
  const historicalDailyRate = historicalSpend / 90;
  const currentDailyRate = forecastExpenseTotal / elapsedDays;
  const dailyRunRate = historicalSpend > 0
    ? currentDailyRate * 0.7 + historicalDailyRate * 0.3
    : currentDailyRate;
  const projectedMonthEnd = forecastExpenseTotal + dailyRunRate * Math.max(0, totalDays - elapsedDays);

  const referenceDate = new Date(Math.min(now.getTime(), new Date(observedEnd).getTime()));
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const dailySpend = new Map<string, number>();
  const recentCategories = new Map<string, number>();
  const previousCategories = new Map<string, number>();
  const recentStart = new Date(referenceDate);
  recentStart.setDate(recentStart.getDate() - 6);
  const previousStart = new Date(referenceDate);
  previousStart.setDate(previousStart.getDate() - 13);

  for (const transaction of forecastTransactions) {
    const occurredAt = new Date(transaction.occurredAt);
    const key = dayKey(occurredAt);
    dailySpend.set(key, (dailySpend.get(key) ?? 0) + transaction.amount);
    const categoryKey = transaction.categoryId ?? "uncategorized";
    if (occurredAt >= recentStart) {
      recentCategories.set(categoryKey, (recentCategories.get(categoryKey) ?? 0) + transaction.amount);
    } else if (occurredAt >= previousStart) {
      previousCategories.set(categoryKey, (previousCategories.get(categoryKey) ?? 0) + transaction.amount);
    }
  }

  const spendOnOffset = (daysAgo: number) => {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - daysAgo);
    return dailySpend.get(dayKey(date)) ?? 0;
  };
  const todaySpend = spendOnOffset(0);
  const yesterdaySpend = spendOnOffset(1);
  const dayOverDayRatio = yesterdaySpend ? (todaySpend - yesterdaySpend) / yesterdaySpend : 0;
  const dayOverDayLabel = yesterdaySpend === 0
    ? todaySpend === 0 ? "No spend" : "New spend"
    : `${Math.round(Math.abs(dayOverDayRatio) * 100)}% ${dayOverDayRatio <= 0 ? "less" : "more"}`;
  const dayOverDayTone: StatTone = yesterdaySpend === 0 ? "neutral" : dayOverDayRatio <= 0 ? "positive" : "negative";
  const recentSevenDaySpend = Array.from({ length: 7 }, (_, index) => spendOnOffset(index)).reduce((total, amount) => total + amount, 0);
  const previousSevenDaySpend = Array.from({ length: 7 }, (_, index) => spendOnOffset(index + 7)).reduce((total, amount) => total + amount, 0);
  const recentDailyAverage = recentSevenDaySpend / 7;
  const weeklyPaceRatio = previousSevenDaySpend ? (recentSevenDaySpend - previousSevenDaySpend) / previousSevenDaySpend : 0;
  const weeklyPaceLabel = previousSevenDaySpend === 0
    ? recentSevenDaySpend === 0 ? "No spend" : "New activity"
    : `${Math.round(Math.abs(weeklyPaceRatio) * 100)}% ${weeklyPaceRatio <= 0 ? "lower" : "higher"}`;
  const weeklyPaceTone: StatTone = previousSevenDaySpend === 0 ? "neutral" : weeklyPaceRatio <= 0 ? "positive" : "negative";

  let noSpendStreak = 0;
  for (let daysAgo = 0; daysAgo < totalDays; daysAgo += 1) {
    if (spendOnOffset(daysAgo) > 0) {
      break;
    }
    noSpendStreak += 1;
  }
  const spendingFreeDays = Array.from({ length: 7 }, (_, index) => spendOnOffset(index)).filter((amount) => amount === 0).length;
  const expectedSpendToDate = projectedMonthEnd * (elapsedDays / totalDays);
  const paceRatio = expectedSpendToDate ? (forecastExpenseTotal - expectedSpendToDate) / expectedSpendToDate : 0;
  const paceLabel = Math.abs(paceRatio) < 0.1 ? "On pace" : `${Math.round(Math.abs(paceRatio) * 100)}% ${paceRatio > 0 ? "ahead" : "behind"}`;
  const paceDetail = `${Math.round((elapsedDays / totalDays) * 100)}% of the period elapsed`;
  const paceTone: StatTone = Math.abs(paceRatio) < 0.1 ? "neutral" : paceRatio > 0 ? "negative" : "positive";
  const unusualSpend = amounts.length >= 3 && largestTransaction > medianTransaction * 2 ? largestTransaction : 0;
  const impulseLabel = unusualSpend ? "Worth reviewing" : "No unusual spend";

  const categoryNames = new Map((report?.byCategory ?? []).map((item) => [item.categoryId ?? "uncategorized", item.categoryName]));
  const recentCategoryTotal = Array.from(recentCategories.values()).reduce((total, amount) => total + amount, 0);
  const previousCategoryTotal = Array.from(previousCategories.values()).reduce((total, amount) => total + amount, 0);
  const categoryKeys = new Set([...recentCategories.keys(), ...previousCategories.keys()]);
  const categoryShift = Array.from(categoryKeys).map((categoryId) => {
    const recentShare = recentCategoryTotal ? (recentCategories.get(categoryId) ?? 0) / recentCategoryTotal : 0;
    const previousShare = previousCategoryTotal ? (previousCategories.get(categoryId) ?? 0) / previousCategoryTotal : 0;
    return { categoryId, delta: recentShare - previousShare };
  }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0];
  const categoryShiftName = categoryShift ? categoryNames.get(categoryShift.categoryId) ?? "Uncategorized" : "No shift";
  const categoryShiftLabel = categoryShift ? `${categoryShiftName} ${categoryShift.delta >= 0 ? "+" : ""}${Math.round(categoryShift.delta * 100)} pts` : "No shift";
  const categoryShiftDetail = categoryShift ? "Last 7 days vs prior 7" : "Not enough activity yet";
  const recentWeekendSpend = forecastTransactions.reduce((total, transaction) => {
    const occurredAt = new Date(transaction.occurredAt);
    return occurredAt >= recentStart && (occurredAt.getDay() === 0 || occurredAt.getDay() === 6) ? total + transaction.amount : total;
  }, 0);
  const weekendPatternLabel = recentSevenDaySpend ? `${Math.round((recentWeekendSpend / recentSevenDaySpend) * 100)}% weekends` : "No recent spend";
  const weekendPatternDetail = recentSevenDaySpend ? "Share of the last 7 days" : "Add activity to see a pattern";

  const topCategoryTotal = report?.byCategory[0]?.total ?? 0;
  const [topMerchantName = "None yet", topMerchantSpend = 0] =
    Array.from(merchantTotals.entries()).sort((left, right) => right[1] - left[1])[0] ?? [];

  const busiestWeekdayIndex =
    Array.from(weekdayTotals.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 1;
  const busiestHourIndex =
    Array.from(hourTotals.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 12;

  return {
    projectedMonthEnd,
    transactionCount: amounts.length,
    activeDayCount: uniqueDays.length,
    averageTransaction,
    medianTransaction,
    averageActiveDaySpend,
    largestTransaction,
    weekendShare: expenseTotal ? weekendSpend / expenseTotal : 0,
    topCategoryShare: expenseTotal ? topCategoryTotal / expenseTotal : 0,
    projectedVsTrailing: trailingAverage ? projectedMonthEnd / trailingAverage - 1 : 0,
    todaySpend,
    dayOverDayLabel,
    dayOverDayTone,
    recentDailyAverage,
    weeklyPaceLabel,
    weeklyPaceTone,
    noSpendStreak,
    spendingFreeDays,
    paceLabel,
    paceDetail,
    paceTone,
    unusualSpend,
    impulseLabel,
    categoryShiftLabel,
    categoryShiftDetail,
    weekendPatternLabel,
    weekendPatternDetail,
    topMerchantName,
    topMerchantSpend,
    busiestWeekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][busiestWeekdayIndex] ?? "Monday",
    busiestHour: formatHourLabel(busiestHourIndex),
    longestStreak: longestConsecutiveDays(uniqueDays),
  };
}

function median(values: number[]) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}

function longestConsecutiveDays(days: string[]) {
  if (days.length === 0) {
    return 0;
  }

  const timestamps = days
    .map((day) => new Date(`${day}T00:00:00`).getTime())
    .sort((left, right) => left - right);
  let longest = 1;
  let current = 1;

  for (let index = 1; index < timestamps.length; index += 1) {
    const delta = timestamps[index] - timestamps[index - 1];
    if (delta === 1000 * 60 * 60 * 24) {
      current += 1;
      longest = Math.max(longest, current);
    } else if (delta > 0) {
      current = 1;
    }
  }

  return longest;
}

function formatHourLabel(hour: number) {
  const period = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 || 12;
  return `${normalized}:00 ${period}`;
}

const styles = StyleSheet.create({
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 20,
  },
  nerdGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  nerdGridSide: {
    alignContent: "flex-start",
    flex: 1,
    minWidth: 360,
  },
  insightsLayout: {
    gap: 16,
  },
  insightsLayoutWide: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  forecastColumn: {
    gap: 12,
    width: "100%",
  },
  forecastColumnWide: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 600,
    minWidth: 460,
  },
  statTile: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 110,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 16,
    backgroundColor: theme.colors.field,
    gap: 6,
  },
  statModalScrim: {
    alignItems: "center",
    backgroundColor: "rgba(17, 22, 26, 0.52)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  statModalCard: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    gap: 10,
    maxWidth: 460,
    padding: 22,
    width: "100%",
    ...theme.shadow,
  },
  statModalLabel: {
    color: theme.colors.muted,
    fontSize: 16,
    fontWeight: "700",
  },
  statModalValue: {
    color: theme.colors.ink,
    fontSize: 30,
    fontWeight: "800",
  },
  statModalSubvalue: {
    color: theme.colors.muted,
    fontSize: 15,
  },
  statModalDescription: {
    color: theme.colors.ink,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 4,
  },
  statModalDetails: {
    backgroundColor: theme.colors.field,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    gap: 5,
    padding: 12,
  },
  statModalDetail: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  statLabel: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  statValue: {
    color: theme.colors.ink,
    fontSize: 22,
    fontWeight: "800",
  },
  statValuePositive: {
    color: theme.colors.success,
  },
  statValueNegative: {
    color: theme.colors.warning,
  },
  statSubvalue: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  forecastChart: {
    marginBottom: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.field,
  },
  forecastHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 12,
  },
  forecastTitle: {
    color: theme.colors.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  forecastLegend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  forecastTooltip: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.card,
  },
  forecastTooltipText: {
    color: theme.colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  legendLine: {
    width: 18,
    borderTopWidth: 3,
  },
  actualLegend: {
    borderColor: theme.colors.accent,
  },
  projectedLegend: {
    borderColor: theme.colors.warning,
    borderStyle: "dashed",
  },
  legendText: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  forecastAxis: {
    height: 22,
    position: "relative",
  },
  axisStart: {
    left: "4.6%",
    position: "absolute",
  },
  axisToday: {
    marginLeft: -20,
    position: "absolute",
  },
  axisEnd: {
    position: "absolute",
    right: "3.8%",
  },
  emptyState: {
    paddingVertical: 4,
  },
  emptyText: {
    color: theme.colors.muted,
    fontSize: 15,
  },
  errorText: {
    color: theme.colors.warning,
  },
});
