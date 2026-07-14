import { PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { appShellStore, type TabKey } from "../state/app-shell";
import { theme } from "../theme";

type ScreenKey = TabKey | "sign-in";
const pullTriggerDistance = 48;
const pullMaxDistance = 112;

type PullGestureEvent = {
  pageY?: number;
  clientY?: number;
  pointerType?: string;
  pointerId?: number;
  touches?: Array<{ pageY?: number; clientY?: number }>;
  changedTouches?: Array<{ pageY?: number; clientY?: number }>;
  nativeEvent?: {
    pageY?: number;
    clientY?: number;
    pointerType?: string;
    pointerId?: number;
    touches?: Array<{ pageY?: number; clientY?: number }>;
    changedTouches?: Array<{ pageY?: number; clientY?: number }>;
  };
  currentTarget?: {
    setPointerCapture?: (pointerId: number) => void;
  };
  preventDefault?: () => void;
};

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
  const webPullToRefresh = Platform.OS === "web" && compact && Boolean(onRefresh);
  const fabSafe = fabSafeInset && width < 420;
  const scrollOffset = appShellStore((state) => state.scrollOffsets[screenKey] ?? 0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollOffsetRef = useRef(scrollOffset);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const pullingRef = useRef(false);
  const gestureInputRef = useRef<"pointer" | "touch" | null>(null);
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
      gestureInputRef.current = null;
      pullStartYRef.current = null;
      setPullDistance(0);
    }
  }, [onRefresh, webPullToRefresh]);

  function getGesturePageY(event: PullGestureEvent) {
    const source = event.nativeEvent ?? event;
    const touch = source.touches?.[0] ?? source.changedTouches?.[0];
    return source.pageY ?? source.clientY ?? touch?.pageY ?? touch?.clientY ?? null;
  }

  function isAtTop() {
    const scrollNode = scrollViewRef.current as unknown as { scrollTop?: number } | null;
    return (scrollNode?.scrollTop ?? scrollOffsetRef.current) <= 0;
  }

  function handlePullStart(event: PullGestureEvent, input: "pointer" | "touch") {
    if (!webPullToRefresh || refreshing || !isAtTop()) {
      return false;
    }

    pullStartYRef.current = getGesturePageY(event);
    pullDistanceRef.current = 0;
    pullingRef.current = false;
    gestureInputRef.current = input;

    const pointerId = (event.nativeEvent ?? event).pointerId;
    if (input === "pointer" && pointerId !== undefined) {
      event.currentTarget?.setPointerCapture?.(pointerId);
    }
    return true;
  }

  function handlePullMove(event: PullGestureEvent, input: "pointer" | "touch") {
    if (
      !webPullToRefresh ||
      refreshing ||
      gestureInputRef.current !== input ||
      pullStartYRef.current === null ||
      !isAtTop()
    ) {
      return;
    }

    const pageY = getGesturePageY(event);
    if (pageY === null) {
      return;
    }

    const distance = pageY - pullStartYRef.current;
    if (distance <= 0) {
      return;
    }

    pullingRef.current = true;
    const nextDistance = Math.min(pullMaxDistance, Math.round(distance * 0.7));
    pullDistanceRef.current = nextDistance;
    setPullDistance(nextDistance);
    event.preventDefault?.();
  }

  function handlePullEnd(input: "pointer" | "touch") {
    if (gestureInputRef.current !== input) {
      return;
    }

    if (!webPullToRefresh) {
      return;
    }

    const shouldRefresh = pullingRef.current && pullDistanceRef.current >= pullTriggerDistance;
    pullStartYRef.current = null;
    pullingRef.current = false;

    if (shouldRefresh) {
      void triggerRefresh();
      return;
    }

    pullDistanceRef.current = 0;
    gestureInputRef.current = null;
    setPullDistance(0);
  }

  useEffect(() => {
    if (!webPullToRefresh) {
      return;
    }

    const scrollNode = scrollViewRef.current as unknown as HTMLElement | null;
    if (!scrollNode?.addEventListener) {
      return;
    }

    const pointerDown = (event: Event) => {
      const gestureEvent = event as unknown as PullGestureEvent;
      if (gestureEvent.pointerType === "mouse") {
        return;
      }
      handlePullStart(gestureEvent, "pointer");
    };
    const pointerMove = (event: Event) => {
      handlePullMove(event as unknown as PullGestureEvent, "pointer");
    };
    const pointerEnd = () => {
      handlePullEnd("pointer");
    };
    const touchStart = (event: Event) => {
      if (gestureInputRef.current === "pointer") {
        return;
      }
      handlePullStart(event as unknown as PullGestureEvent, "touch");
    };
    const touchMove = (event: Event) => {
      if (gestureInputRef.current === "pointer") {
        return;
      }
      handlePullMove(event as unknown as PullGestureEvent, "touch");
    };
    const touchEnd = () => {
      handlePullEnd("touch");
    };
    const nonPassive = { passive: false } as AddEventListenerOptions;

    scrollNode.addEventListener("pointerdown", pointerDown, nonPassive);
    scrollNode.addEventListener("pointermove", pointerMove, nonPassive);
    scrollNode.addEventListener("pointerup", pointerEnd);
    scrollNode.addEventListener("pointercancel", pointerEnd);
    scrollNode.addEventListener("touchstart", touchStart, nonPassive);
    scrollNode.addEventListener("touchmove", touchMove, nonPassive);
    scrollNode.addEventListener("touchend", touchEnd);
    scrollNode.addEventListener("touchcancel", touchEnd);

    return () => {
      scrollNode.removeEventListener("pointerdown", pointerDown, nonPassive);
      scrollNode.removeEventListener("pointermove", pointerMove, nonPassive);
      scrollNode.removeEventListener("pointerup", pointerEnd);
      scrollNode.removeEventListener("pointercancel", pointerEnd);
      scrollNode.removeEventListener("touchstart", touchStart, nonPassive);
      scrollNode.removeEventListener("touchmove", touchMove, nonPassive);
      scrollNode.removeEventListener("touchend", touchEnd);
      scrollNode.removeEventListener("touchcancel", touchEnd);
    };
  }, [refreshing, triggerRefresh, webPullToRefresh]);

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.scroll}
      contentContainerStyle={[styles.content, compact && styles.contentCompact, fabSafe && styles.contentFabSafe]}
      showsVerticalScrollIndicator
      refreshControl={
        compact && onRefresh && !webPullToRefresh ? (
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
      scrollEventThrottle={16}
    >
      {webPullToRefresh && pullDistance > 0 ? (
        <View style={[styles.pullIndicator, { height: pullDistance }]}>
          <Text style={styles.pullIndicatorText}>
            {refreshing
              ? "Refreshing..."
              : pullDistance >= pullTriggerDistance
                ? "Release to refresh"
                : "Pull to refresh"}
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
