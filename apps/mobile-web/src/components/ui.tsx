import { PropsWithChildren } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { theme } from "../theme";
import { WebPressable as Pressable } from "./web-pressable";

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return <View style={[styles.card, compact && styles.cardCompact, style]}>{children}</View>;
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return (
    <View style={styles.header}>
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text> : null}
    </View>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return (
    <View style={[styles.pageHeader, compact && styles.pageHeaderCompact]}>
      <Text style={[styles.pageTitle, compact && styles.pageTitleCompact]}>{title}</Text>
      {subtitle ? <Text style={[styles.pageSubtitle, compact && styles.pageSubtitleCompact]}>{subtitle}</Text> : null}
    </View>
  );
}

export function PillButton({
  label,
  onPress,
  tone = "primary",
}: {
  label: string;
  onPress?: () => void;
  tone?: "primary" | "ghost";
}) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, compact && styles.buttonCompact, tone === "ghost" ? styles.buttonGhost : styles.buttonPrimary]}
    >
      <Text
        style={[
          styles.buttonText,
          compact && styles.buttonTextCompact,
          tone === "ghost" ? styles.buttonTextGhost : styles.buttonTextPrimary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "warning";
}) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, compact && styles.metricLabelCompact]}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          compact && styles.metricValueCompact,
          tone === "accent" && { color: theme.colors.accent },
          tone === "warning" && { color: theme.colors.warning },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  cardCompact: {
    padding: 16,
  },
  header: {
    gap: 4,
  },
  pageHeader: {
    gap: 6,
    paddingTop: 2,
    paddingBottom: 4,
  },
  pageHeaderCompact: {
    gap: 4,
    paddingBottom: 2,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: theme.colors.ink,
  },
  pageTitleCompact: {
    fontSize: 22,
  },
  pageSubtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.muted,
    maxWidth: 760,
  },
  pageSubtitleCompact: {
    fontSize: 14,
    lineHeight: 21,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: theme.colors.ink,
  },
  titleCompact: {
    fontSize: 20,
  },
  subtitle: {
    fontSize: 15,
    color: theme.colors.muted,
    marginBottom: 6,
  },
  subtitleCompact: {
    fontSize: 14,
    marginBottom: 7,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignSelf: "flex-start",
  },
  buttonCompact: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonPrimary: {
    backgroundColor: theme.colors.accent,
  },
  buttonGhost: {
    backgroundColor: theme.colors.accentSoft,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  buttonTextCompact: {
    fontSize: 14,
  },
  buttonTextPrimary: {
    color: "#FFFFFF",
  },
  buttonTextGhost: {
    color: theme.colors.accent,
  },
  metric: {
    gap: 4,
    flex: 1,
    minWidth: 140,
  },
  metricLabel: {
    fontSize: 14,
    color: theme.colors.muted,
  },
  metricLabelCompact: {
    fontSize: 13,
  },
  metricValue: {
    fontSize: 28,
    fontWeight: "800",
    color: theme.colors.ink,
  },
  metricValueCompact: {
    fontSize: 24,
  },
});
