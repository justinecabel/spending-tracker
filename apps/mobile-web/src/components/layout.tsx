import { PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
  const webPullToRefresh = Platform.OS === "web" && Boolean(onRefresh);
  const fabSafe = fabSafeInset && width < 420;
  const scrollOffset = appShellStore((state) => state.scrollOffsets[screenKey] ?? 0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollOffsetRef = useRef(scrollOffset);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const restoredRef = useRef(false);
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

  useEffect(() => {
    scrollOffsetRef.current = scrollOffset;
  }, [scrollOffset]);

  const triggerRefresh = useCallback(async () => {
    if (!onRefresh || refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    setPullDistance(webPullToRefresh ? 48 : 0);
    try {
      await onRefresh();
    } finally {
      refreshInFlightRef.current = false;
      pullDistanceRef.current = 0;
      pullingRef.current = false;
      pullStartYRef.current = null;
      setPullDistance(0);
    }
  }, [onRefresh, webPullToRefresh]);

  function getTouchPageY(event: { nativeEvent?: { touches?: Array<{ pageY?: number; clientY?: number }> } }) {
    const touch = event.nativeEvent?.touches?.[0];
    return touch?.pageY ?? touch?.clientY ?? null;
  }

  function handleTouchStart(event: { nativeEvent?: { touches?: Array<{ pageY?: number; clientY?: number }> } }) {
    if (!webPullToRefresh || refreshing || scrollOffsetRef.current > 0) {
      return;
    }

    pullStartYRef.current = getTouchPageY(event);
    pullDistanceRef.current = 0;
    pullingRef.current = false;
  }

  function handleTouchMove(event: { nativeEvent?: { touches?: Array<{ pageY?: number; clientY?: number }> } }) {
    if (!webPullToRefresh || refreshing || pullStartYRef.current === null || scrollOffsetRef.current > 0) {
      return;
    }

    const pageY = getTouchPageY(event);
    if (pageY === null) {
      return;
    }

    const distance = pageY - pullStartYRef.current;
    if (distance <= 0) {
      return;
    }

    pullingRef.current = true;
    const nextDistance = Math.min(96, Math.round(distance * 0.55));
    pullDistanceRef.current = nextDistance;
    setPullDistance(nextDistance);
  }

  function handleTouchEnd() {
    if (!webPullToRefresh) {
      return;
    }

    const shouldRefresh = pullingRef.current && pullDistanceRef.current >= 56;
    pullStartYRef.current = null;
    pullingRef.current = false;

    if (shouldRefresh) {
      void triggerRefresh();
      return;
    }

    pullDistanceRef.current = 0;
    setPullDistance(0);
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.scroll}
      contentContainerStyle={[styles.content, compact && styles.contentCompact, fabSafe && styles.contentFabSafe]}
      showsVerticalScrollIndicator
      refreshControl={
        onRefresh && !webPullToRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void triggerRefresh()}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
            progressBackgroundColor="#FFFFFF"
          />
        ) : undefined
      }
      onScroll={(event) => {
        const nextOffset = Math.max(0, event.nativeEvent.contentOffset.y);
        scrollOffsetRef.current = nextOffset;
        setScrollOffset(screenKey, nextOffset);
      }}
      onTouchStart={webPullToRefresh ? handleTouchStart : undefined}
      onTouchMove={webPullToRefresh ? handleTouchMove : undefined}
      onTouchEnd={webPullToRefresh ? handleTouchEnd : undefined}
      onTouchCancel={webPullToRefresh ? handleTouchEnd : undefined}
      scrollEventThrottle={16}
    >
      {webPullToRefresh && pullDistance > 0 ? (
        <View style={[styles.pullIndicator, { height: pullDistance }]}>
          <Text style={styles.pullIndicatorText}>
            {refreshing ? "Refreshing..." : pullDistance >= 56 ? "Release to refresh" : "Pull to refresh"}
          </Text>
        </View>
      ) : null}
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
  pullIndicator: {
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 10,
  },
  pullIndicatorText: {
    color: theme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
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
