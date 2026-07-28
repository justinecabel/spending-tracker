import { PropsWithChildren, useState, type ReactNode } from "react";
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { theme } from "../theme";
import { WebPressable as Pressable } from "./web-pressable";

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return <View style={[styles.card, compact && styles.cardCompact, style]}>{children}</View>;
}

export function FormModal({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = "compact",
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  size?: "compact" | "wide";
}>) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.formModalScrim, compact && styles.formModalScrimCompact]}>
        <View style={[styles.formModalCard, size === "wide" && styles.formModalCardWide]}>
          <ScrollView
            contentContainerStyle={[styles.formModalContent, compact && styles.formModalContentCompact]}
            showsVerticalScrollIndicator
          >
            <View style={styles.formModalHeader}>
              <View style={styles.formModalHeading}>
                <View style={styles.headingRow}>
                  <Text style={[styles.formModalTitle, compact && styles.formModalTitleCompact]}>{title}</Text>
                  {subtitle ? <HelpTooltip text={subtitle} label={`About ${title}`} /> : null}
                </View>
              </View>
              <PillButton label="Close" tone="ghost" onPress={onClose} />
            </View>
            <View style={styles.formModalBody}>{children}</View>
            {footer ? <View style={styles.formModalFooter}>{footer}</View> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function HelpTooltip({ text, label = "More information" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.helpContainer}>
      <Pressable
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={[styles.helpButton, open && styles.helpButtonOpen]}
      >
        <Text style={[styles.helpButtonText, open && styles.helpButtonTextOpen]}>?</Text>
      </Pressable>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.helpModalScrim}>
          <View
            accessibilityRole="alert"
            accessibilityViewIsModal
            style={styles.helpModalCard}
          >
            <Text style={styles.helpModalTitle}>{label}</Text>
            <Text style={styles.helpModalText}>{text}</Text>
            <View style={styles.helpModalActions}>
              <PillButton label="Close" tone="ghost" onPress={() => setOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function SectionTitle({
  title,
  subtitle,
  subtitleMode = "help",
}: {
  title: string;
  subtitle?: string;
  subtitleMode?: "help" | "inline";
}) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return (
    <View style={styles.header}>
      <View style={styles.headingRow}>
        <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
        {subtitle && subtitleMode === "help" ? <HelpTooltip text={subtitle} label={`About ${title}`} /> : null}
      </View>
      {subtitle && subtitleMode === "inline" ? (
        <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

export function PageHeader({
  title,
  subtitle,
  subtitleMode = "help",
}: {
  title: string;
  subtitle?: string;
  subtitleMode?: "help" | "inline";
}) {
  const { width } = useWindowDimensions();
  const compact = width < 640;

  return (
    <View style={[styles.pageHeader, compact && styles.pageHeaderCompact]}>
      <View style={styles.headingRow}>
        <Text style={[styles.pageTitle, compact && styles.pageTitleCompact]}>{title}</Text>
        {subtitle && subtitleMode === "help" ? <HelpTooltip text={subtitle} label={`About ${title}`} /> : null}
      </View>
      {subtitle && subtitleMode === "inline" ? (
        <Text style={[styles.pageSubtitle, compact && styles.pageSubtitleCompact]}>{subtitle}</Text>
      ) : null}
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
  formModalScrim: {
    flex: 1,
    backgroundColor: "rgba(27, 29, 31, 0.42)",
    justifyContent: "center",
    padding: 20,
  },
  formModalScrimCompact: {
    padding: 10,
  },
  formModalCard: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 560,
    maxHeight: "92%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    ...theme.shadow,
  },
  formModalCardWide: {
    maxWidth: 900,
  },
  formModalContent: {
    padding: 20,
  },
  formModalContentCompact: {
    padding: 16,
  },
  formModalHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  formModalHeading: {
    flex: 1,
    minWidth: 190,
    gap: theme.spacing.xs,
  },
  headingRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  formModalTitle: {
    color: theme.colors.ink,
    ...theme.typography.sectionTitle,
    fontWeight: "800",
  },
  formModalTitleCompact: {
    fontSize: 22,
    lineHeight: 28,
  },
  formModalSubtitle: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  helpContainer: {
    alignSelf: "center",
  },
  helpButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accentSoft,
    borderRadius: 999,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  helpButtonOpen: {
    backgroundColor: theme.colors.accent,
  },
  helpButtonText: {
    color: theme.colors.accentSoftText,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 16,
  },
  helpButtonTextOpen: {
    color: theme.colors.accentText,
  },
  helpModalScrim: {
    alignItems: "center",
    backgroundColor: "rgba(27, 29, 31, 0.24)",
    flex: 1,
    justifyContent: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 72,
    zIndex: 2147483647,
  },
  helpModalCard: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.md,
    maxWidth: 420,
    padding: 18,
    width: "100%",
    elevation: 24,
    ...theme.shadow,
  },
  helpModalTitle: {
    color: theme.colors.ink,
    ...theme.typography.subheading,
    fontWeight: "800",
  },
  helpModalText: {
    color: theme.colors.ink,
    ...theme.typography.body,
  },
  helpModalActions: {
    alignItems: "flex-end",
    marginTop: 4,
  },
  formModalBody: {
    flexShrink: 0,
    gap: theme.spacing.lg,
  },
  formModalFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 16,
    marginTop: 4,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.lg,
    ...theme.shadow,
  },
  cardCompact: {
    padding: 16,
    gap: 14,
  },
  header: {
    gap: theme.spacing.xs,
  },
  pageHeader: {
    gap: theme.spacing.sm,
    paddingTop: 2,
    paddingBottom: 4,
  },
  pageHeaderCompact: {
    gap: theme.spacing.xs,
    paddingBottom: 2,
  },
  pageTitle: {
    ...theme.typography.pageTitle,
    fontWeight: "800",
    color: theme.colors.ink,
  },
  pageTitleCompact: {
    fontSize: 22,
    lineHeight: 28,
  },
  pageSubtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
    maxWidth: 760,
  },
  pageSubtitleCompact: {
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    ...theme.typography.sectionTitle,
    fontWeight: "700",
    color: theme.colors.ink,
  },
  titleCompact: {
    fontSize: 20,
    lineHeight: 26,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  subtitleCompact: {
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignSelf: "flex-start",
  },
  buttonCompact: {
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonPrimary: {
    backgroundColor: theme.colors.accent,
  },
  buttonGhost: {
    backgroundColor: theme.colors.accentSoft,
  },
  buttonText: {
    ...theme.typography.control,
    fontWeight: "700",
  },
  buttonTextCompact: {
    fontSize: 15,
    lineHeight: 20,
  },
  buttonTextPrimary: {
    color: theme.colors.accentText,
  },
  buttonTextGhost: {
    color: theme.colors.accentSoftText,
  },
  metric: {
    gap: theme.spacing.xs,
    flex: 1,
    minWidth: 140,
  },
  metricLabel: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.muted,
  },
  metricLabelCompact: {
    fontSize: 13,
    lineHeight: 18,
  },
  metricValue: {
    ...theme.typography.metric,
    fontWeight: "800",
    color: theme.colors.ink,
  },
  metricValueCompact: {
    fontSize: 24,
    lineHeight: 30,
  },
});
