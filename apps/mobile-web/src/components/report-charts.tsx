import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MonthlyReport } from "@spending-tracker/shared";
import { formatMoney } from "../lib/date";
import { theme } from "../theme";
import { WebPressable } from "./web-pressable";

const chartPalette = ["#0F766E", "#F97316", "#2563EB", "#DC2626", "#7C3AED", "#0891B2"];

export function ReportCharts({
  report,
  currency = "USD",
}: {
  report: MonthlyReport;
  currency?: string;
}) {
  if (report.byCategory.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No expense data yet.</Text>
      </View>
    );
  }

  const total = report.expenseTotal || 1;
  const topCategories = report.byCategory.slice(0, 5);
  const remainingTotal = Math.max(0, report.expenseTotal - topCategories.reduce((sum, item) => sum + item.total, 0));
  const donutData = [
    ...topCategories,
    ...(remainingTotal > 0
      ? [{ categoryId: null, categoryName: "Other", total: remainingTotal }]
      : []),
  ].map((item, index) => ({
    ...item,
    color: chartPalette[index % chartPalette.length],
    percentage: item.total / total,
  }));

  return (
    <View style={styles.wrapper}>
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Expense share</Text>
        <ExpenseSharePieChart segments={donutData} currency={currency} />
        <View style={styles.legend}>
          {donutData.map((segment) => (
            <View key={segment.categoryId ?? segment.categoryName} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: segment.color }]} />
              <View style={styles.legendTextBlock}>
                <Text style={styles.legendLabel}>{segment.categoryName}</Text>
                <Text style={styles.legendValue}>
                  {formatMoney(segment.total, currency)} · {Math.round(segment.percentage * 100)}%
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {false ? <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Top spend</Text>
        <View style={styles.barList}>
          {report.byCategory.slice(0, 5).map((item, index) => {
            const widthRatio = Math.max(item.total / Math.max(total, 1), 0.06);

            return (
              <View key={item.categoryId ?? item.categoryName} style={styles.barRow}>
                <View style={styles.barMain}>
                  <Text style={styles.barLabel}>{item.categoryName}</Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.min(widthRatio * 100, 100)}%`,
                          backgroundColor: chartPalette[index % chartPalette.length],
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text style={styles.barMeta}>{formatMoney(item.total, currency)}</Text>
              </View>
            );
          })}
        </View>
      </View> : null}
    </View>
  );
}

type ExpenseShareSegment = {
  categoryId: string | null;
  categoryName: string;
  total: number;
  color: string;
  percentage: number;
};

function ExpenseSharePieChart({ segments, currency }: { segments: ExpenseShareSegment[]; currency: string }) {
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const activeSegment = activeSegmentIndex === null ? null : segments[activeSegmentIndex];
  const gradient = pieGradient(segments);
  const selectionMask = activeSegmentIndex === null ? null : pieSelectionMask(segments, activeSegmentIndex);

  return (
    <View style={styles.pieChartWrap}>
      <View
        accessibilityLabel="Expense share pie chart"
        style={[
          styles.pieHitArea,
          { backgroundImage: gradient } as any,
        ]}
      >
        {selectionMask ? <View style={[styles.pieSelectionMask, { backgroundImage: selectionMask } as any]} /> : null}
        <View style={styles.pieCenter} />
      </View>
      <View style={styles.pieTooltip} accessibilityLiveRegion="polite">
        {activeSegment ? (
          <>
            <View style={[styles.legendDot, { backgroundColor: activeSegment.color }]} />
            <View style={styles.pieTooltipText}>
              <Text style={styles.pieTooltipLabel}>{activeSegment.categoryName}</Text>
              <Text style={styles.pieTooltipValue}>
                {formatMoney(activeSegment.total, currency)} · {Math.round(activeSegment.percentage * 100)}%
              </Text>
            </View>
          </>
        ) : null}
      </View>
      <View style={styles.categoryControls} accessibilityLabel="Choose a category to highlight its share">
        {segments.map((segment, index) => {
          const selected = activeSegmentIndex === index;
          return (
            <WebPressable
              key={segment.categoryId ?? segment.categoryName}
              accessibilityRole="button"
              onPress={() => setActiveSegmentIndex(selected ? null : index)}
              style={[styles.categoryControl, selected && styles.categoryControlSelected]}
            >
              <View style={[styles.legendDot, { backgroundColor: segment.color }]} />
              <Text style={styles.categoryControlLabel}>{segment.categoryName}</Text>
              <Text style={styles.categoryControlValue}>{Math.round(segment.percentage * 100)}%</Text>
            </WebPressable>
          );
        })}
      </View>
    </View>
  );
}

function pieGradient(segments: ExpenseShareSegment[]) {
  let position = 0;
  const stops = segments.map((segment) => {
    const nextPosition = position + segment.percentage * 100;
    const stop = `${segment.color} ${position}% ${nextPosition}%`;
    position = nextPosition;
    return stop;
  });
  return `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

function pieSelectionMask(segments: ExpenseShareSegment[], index: number) {
  const start = segments.slice(0, index).reduce((sum, segment) => sum + segment.percentage, 0) * 100;
  const end = start + segments[index]!.percentage * 100;
  return `conic-gradient(from -90deg, rgba(0, 0, 0, 0.34) 0% ${start}%, transparent ${start}% ${end}%, rgba(0, 0, 0, 0.34) ${end}% 100%)`;
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 20,
  },
  chartCard: {
    gap: 16,
  },
  chartTitle: {
    color: theme.colors.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  pieChartWrap: {
    alignItems: "center",
    gap: 8,
  },
  pieHitArea: {
    alignItems: "center",
    borderRadius: 92,
    justifyContent: "center",
    height: 184,
    width: 184,
  },
  pieCenter: {
    backgroundColor: theme.colors.card,
    borderRadius: 32,
    height: 64,
    width: 64,
  },
  pieSelectionMask: {
    borderRadius: 92,
    height: 184,
    position: "absolute",
    width: 184,
  },
  pieTooltip: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pieTooltipText: {
    alignItems: "center",
  },
  pieTooltipLabel: {
    color: theme.colors.ink,
    fontWeight: "700",
  },
  pieTooltipValue: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  pieHint: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  categoryControls: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  categoryControl: {
    alignItems: "center",
    backgroundColor: theme.colors.field,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryControlSelected: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  categoryControlLabel: {
    color: theme.colors.ink,
    fontWeight: "700",
  },
  categoryControlValue: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  legend: {
    display: "none",
    gap: 10,
    width: "100%",
  },
  legendRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  legendTextBlock: {
    flex: 1,
  },
  legendLabel: {
    color: theme.colors.ink,
    fontWeight: "700",
  },
  legendValue: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  barList: {
    gap: 14,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },
  barMain: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  barLabel: {
    color: theme.colors.ink,
    fontWeight: "700",
  },
  barMeta: {
    color: theme.colors.muted,
    fontSize: 13,
    width: 88,
    textAlign: "right",
  },
  barTrack: {
    width: "100%",
    height: 16,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: theme.colors.border,
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
  },
  emptyState: {
    paddingVertical: 4,
  },
  emptyText: {
    color: theme.colors.muted,
    fontSize: 15,
  },
});
