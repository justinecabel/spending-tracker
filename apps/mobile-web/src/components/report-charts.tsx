import { StyleSheet, Text, View } from "react-native";
import type { MonthlyReport } from "@spending-tracker/shared";
import { formatMoney } from "../lib/date";
import { theme } from "../theme";

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
  const donutData = report.byCategory.slice(0, 5).map((item, index) => ({
    ...item,
    color: chartPalette[index % chartPalette.length],
    percentage: item.total / total,
  }));

  return (
    <View style={styles.wrapper}>
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Expense share</Text>
        <View style={styles.segmentBar}>
          {donutData.map((segment) => (
            <View
              key={segment.categoryId ?? segment.categoryName}
              style={[
                styles.segment,
                {
                  backgroundColor: segment.color,
                  flex: Math.max(segment.percentage, 0.06),
                },
              ]}
            />
          ))}
        </View>
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

      <View style={styles.chartCard}>
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
      </View>
    </View>
  );
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
  segmentBar: {
    flexDirection: "row",
    alignItems: "stretch",
    width: "100%",
    height: 20,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: theme.colors.border,
  },
  segment: {
    height: "100%",
  },
  legend: {
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
