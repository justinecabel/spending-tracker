import { PropsWithChildren, useEffect, useRef } from "react";
import { RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { appShellStore, type TabKey } from "../state/app-shell";
import { theme } from "../theme";

type ScreenKey = TabKey | "sign-in";

export function ScreenContainer({
  children,
  screenKey,
  fabSafeInset = false,
  onRefresh,
  refreshing = false,
}: PropsWithChildren<{
  screenKey: ScreenKey;
  fabSafeInset?: boolean;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
}>) {
  const { width } = useWindowDimensions();
  const compact = width < 640;
  const fabSafe = fabSafeInset && width < 420;
  const scrollViewRef = useRef<ScrollView | null>(null);
  const restoredRef = useRef(false);
  const scrollOffset = appShellStore((state) => state.scrollOffsets[screenKey] ?? 0);
  const setScrollOffset = appShellStore((state) => state.setScrollOffset);

  useEffect(() => {
    restoredRef.current = false;
  }, [screenKey]);

  useEffect(() => {
    if (restoredRef.current || !scrollViewRef.current || !scrollOffset) {
      return;
    }

    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: scrollOffset, animated: false });
      restoredRef.current = true;
    }, 0);

    return () => clearTimeout(timer);
  }, [screenKey, scrollOffset]);

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.scroll}
      contentContainerStyle={[styles.content, compact && styles.contentCompact, fabSafe && styles.contentFabSafe]}
      showsVerticalScrollIndicator
      refreshControl={
        compact && onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void onRefresh();
            }}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
            progressBackgroundColor="#FFFFFF"
          />
        ) : undefined
      }
      onScroll={(event) => {
        setScrollOffset(screenKey, event.nativeEvent.contentOffset.y);
      }}
      scrollEventThrottle={16}
    >
      <View style={[styles.inner, compact && styles.innerCompact]}>{children}</View>
    </ScrollView>
  );
}

export function ResponsiveGrid({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const stacked = width < 960;
  return (
    <View style={[styles.grid, stacked && styles.gridStacked]}>
      <View style={[styles.gridCell, stacked && styles.gridCellStacked]}>{left}</View>
      <View style={[styles.gridCell, stacked && styles.gridCellStacked]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.paper,
  },
  content: {
    flexGrow: 1,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 32,
    alignItems: "center",
  },
  contentCompact: {
    paddingTop: 14,
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  contentFabSafe: {
    paddingBottom: 14,
  },
  inner: {
    width: "100%",
    maxWidth: 1180,
    gap: 20,
  },
  innerCompact: {
    gap: 14,
  },
  grid: {
    flexDirection: "row",
    gap: 20,
    alignItems: "flex-start",
    width: "100%",
  },
  gridStacked: {
    flexDirection: "column",
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  gridCellStacked: {
    flex: 0,
    width: "100%",
  },
});
