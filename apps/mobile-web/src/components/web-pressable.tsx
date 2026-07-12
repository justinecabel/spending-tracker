import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Platform, Pressable as NativePressable, StyleSheet } from "react-native";

type WebPressableProps = ComponentProps<typeof NativePressable>;

/**
 * React Native Web's Pressability layer can drop `onPress` handlers in an
 * exported static bundle. Render a real HTML button on web while preserving
 * native `onPress` behavior elsewhere.
 */
export function WebPressable({ onPress, accessibilityRole, ...props }: WebPressableProps) {
  if (Platform.OS === "web") {
    const resolvedStyle =
      typeof props.style === "function"
        ? (props.style as (state: unknown) => unknown)({})
        : props.style;
    const children: ReactNode =
      typeof props.children === "function"
        ? ((props.children as (state: unknown) => unknown)({}) as ReactNode)
        : props.children;
    const style = StyleSheet.flatten(resolvedStyle as any) as CSSProperties;

    return (
      <button
        type="button"
        onClick={onPress as unknown as () => void}
        style={{
          ...style,
          appearance: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          borderStyle: "solid",
        } as CSSProperties}
      >
        {children}
      </button>
    );
  }

  return (
    <NativePressable
      {...props}
      accessibilityRole={accessibilityRole ?? "button"}
      onPress={onPress}
    />
  );
}
