import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Platform, Pressable as NativePressable, StyleSheet } from "react-native";

type WebPressableProps = ComponentProps<typeof NativePressable>;

function toWebButtonStyle(style: Record<string, unknown>): CSSProperties {
  const { marginHorizontal, marginVertical, paddingHorizontal, paddingVertical, ...webStyle } = style;

  return {
    ...webStyle,
    ...(typeof paddingHorizontal === "number" || typeof paddingHorizontal === "string"
      ? { paddingLeft: paddingHorizontal, paddingRight: paddingHorizontal }
      : {}),
    ...(typeof paddingVertical === "number" || typeof paddingVertical === "string"
      ? { paddingTop: paddingVertical, paddingBottom: paddingVertical }
      : {}),
    ...(typeof marginHorizontal === "number" || typeof marginHorizontal === "string"
      ? { marginLeft: marginHorizontal, marginRight: marginHorizontal }
      : {}),
    ...(typeof marginVertical === "number" || typeof marginVertical === "string"
      ? { marginTop: marginVertical, marginBottom: marginVertical }
      : {}),
  } as CSSProperties;
}

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
    const style = toWebButtonStyle(StyleSheet.flatten(resolvedStyle as any) ?? {});

    return (
      <button
        type="button"
        onClick={onPress as unknown as () => void}
        style={{
          appearance: "none",
          alignItems: "stretch",
          backgroundColor: "transparent",
          boxSizing: "border-box",
          color: "inherit",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          fontFamily: "inherit",
          justifyContent: "flex-start",
          margin: 0,
          textAlign: "left",
          borderStyle: "solid",
          borderWidth: 0,
          ...style,
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
